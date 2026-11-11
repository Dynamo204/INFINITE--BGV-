const axios = require("axios");
const { randomUUID } = require("crypto");
const config = require("../config/config");
const {
    getEducationAttachments,
    getAdditionalAttachments,
    getCFirstCandidateSourceData,
    findBgvRecordByEmployeeId,
    updateBgvRecord,
    resolveBgvStatusCode,
    findPicklistCode,
    getCaseIdField
} = require("./successFactorsService");
const caseStore = require("./caseStore");

const CHECKLIST_CACHE_TTL_MS = 5 * 60 * 1000;
const ADAMMA_REQUEST_TIMEOUT_MS = 45000;
const CFIRST_REQUEST_TIMEOUT_MS = 45000;
const PARISHRAM_REQUEST_TIMEOUT_MS = 45000;
const VIBRANT_REQUEST_TIMEOUT_MS = 45000;
const CFIRST_RETRYABLE_NETWORK_CODES = new Set([
    "ECONNABORTED",
    "ETIMEDOUT",
    "ECONNRESET",
    "EAI_AGAIN",
    "ENOTFOUND",
    "ECONNREFUSED",
    "EHOSTUNREACH",
    "ENETUNREACH"
]);
const CFIRST_CHECK_NAMES = new Set([
    "credit",
    "criminal",
    "employment",
    "identity",
    "education"
]);
const CFIRST_ALLOWED_ATTACHMENT_TYPES = new Set([
    "pdf",
    "jpg",
    "jpeg",
    "png"
]);
const LAST_KNOWN_CFIRST_CHECKS = [
    { id: "225", name: "Credit", description: "", quantity: 0 },
    { id: "226", name: "Criminal", description: "", quantity: 0 },
    { id: "227", name: "Employment", description: "", quantity: 0 },
    { id: "228", name: "Identity", description: "", quantity: 0 },
    { id: "229", name: "Education", description: "", quantity: 0 }
];
const LAST_KNOWN_CFIRST_PACKAGES = [
    { id: "1013", name: "Freshers", description: "1 - CRIMINAL COURT, 1 - EDUCATION, 1 - IDENTITY, 1 - REFERENCE", price: "1000" },
    { id: "1099", name: "Horizontal Talent - Test Package", description: "2 - ADDRESS, 1 - EDUCATION, Last 7 years of EMPLOYMENT, 1 - IDENTITY, 1 - RESUME", price: "100000" },
    { id: "1241", name: "Education_Employment", description: "1 - EDUCATION, Last 5 years of EMPLOYMENT", price: "2500" },
    { id: "1259", name: "PRE BGV", description: "1 - CREDIT, 1 - CRIMINAL, 1 - EDUCATION, 1 - IDENTITY", price: "5000" },
    { id: "1294", name: "Test Package All Checks", description: "Last 2 years of ADDRESS, 1 - ALCOHOL TEST, 1 - CREDENTIAL, 1 - CREDIT, Last 1 years of CRIMINAL, Last 3 years of CRIMINAL COUNTY, Last 5 years of CRIMINAL COURT, 1 - DATABASE, 1 - DRUG TEST, 1 - EDUCATION, Last 7 years of EMPLOYMENT, 1 - IDENTITY, 1 - IDENTITY AADHAR CARD, 1 - IDENTITY DRIVING LICENSE, 1 - IDENTITY PAN NUMBER, 1 - PSYCHOMETRIC, 1 - REFERENCE, 1 - RESUME", price: "200" },
    { id: "1346", name: "POST EMP", description: "Last 1 years of EMPLOYMENT", price: "111" },
    { id: "1451", name: "Verizon Package 1", description: "Last 7 years of ADDRESS, 1 - CRIMINAL COURT, 2 - DATABASE, 1 - DRUG TEST, 1 - EDUCATION, Last 7 years of EMPLOYMENT, 1 - IDENTITY PASSPORT", price: "0" },
    { id: "1452", name: "Brillio Package 2", description: "Last 7 years of ADDRESS, 1 - EDUCATION, Last 2 years of EMPLOYMENT", price: "0" },
    { id: "1517", name: "Merit Group -Chennai", description: "1 - CRIMINAL, 1 - EDUCATION, 2 - EMPLOYMENT", price: "0" },
    { id: "1519", name: "Panamax Group", description: "1 - ADDRESS, 1 - CRIMINAL COURT, 1 - EDUCATION, 3 - EMPLOYMENT", price: "0" },
    { id: "1605", name: "Test Address", description: "Last 1 years of ADDRESS, 1 - ALCOHOL ALCOHOL BLOOD", price: "1" },
    { id: "1606", name: "Test Add2", description: "1 - ALCOHOL ALCOHOL BLOOD, Last 1 years of CURRENT ADDRESS, 1 - PERMANENT ADDRESS", price: "0" },
    { id: "1860", name: "CAPGEMINI Test", description: "1 - CRIMINAL COURT, 1 - DATABASE EXTENSIVE NEW, 1 - EDUCATION, 1 - EMPLOYMENT", price: "0" },
    { id: "2238", name: "ADD_REF", description: "1 - ADDRESS, 1 - REFERENCE", price: "100" },
    { id: "2266", name: "TesT Today 56", description: "Last 2 years of CURRENT ADDRESS", price: "222222" },
    { id: "2267", name: "Today 67", description: "1 - CREDENTIAL PARA MEDICAL COUNCIL", price: "555" }
];
let checklistCache = null;
let checklistCacheExpiresAt = 0;
let checklistRequestInFlight = null;

const LAST_KNOWN_ADAMMA_CHECKS = [
    "SAM",
    "10 Panel Drug Abuse Test",
    "5 Panel Drug Abuse Test",
    "Bank Statement Verification",
    "Credit Check",
    "Criminal Court",
    "Directorship Check",
    "Driving License Check",
    "Education",
    "Employment",
    "GAP Analysis",
    "Identity",
    "MCA Check",
    "OIG",
    "Permanent Address",
    "Permanent and Current Address",
    "Professional Reference",
    "OFAC",
    "FCA Financial Conduct Authority Database Check",
    "Web and Media Check",
    "Current Address",
    "Resume Checks",
    "International Database Check",
    "Tax Record Check"
].map(name => ({ id: name, name, description: "", quantity: 0 }));

const LAST_KNOWN_PARISHRAM_CHECKS = [
    "Employment Credential Check",
    "Educational Qualification Check",
    "Criminal Verification through Court Record Check",
    "Digital Residential Address Check",
    "Global Database Check",
    "Directorship Check",
    "Social Media Check",
    "CIBIL Check / Consumer credit",
    "Credit & Bankruptcy Check",
    "Reputational media",
    "Civil litigation",
    "Banned/Disqualified persons"
].map(name => ({ id: name, name, description: "", quantity: 0 }));

const LAST_KNOWN_VIBRANT_CHECKS = [
    "Identity Verification",
    "Address Verification",
    "Education Verification",
    "Employment Verification",
    "Reference Verification"
].map(name => ({ id: name, name, description: "", quantity: 0 }));

function getLastKnownAdammaChecks() {
    return LAST_KNOWN_ADAMMA_CHECKS.map(check => ({ ...check }));
}

function getLastKnownParishramChecks() {
    return LAST_KNOWN_PARISHRAM_CHECKS.map(check => ({ ...check }));
}

function getLastKnownVibrantChecks() {
    return LAST_KNOWN_VIBRANT_CHECKS.map(check => ({ ...check }));
}

function getVibrantFallbackWarning(error) {
    return "Using standard Vibrant checks.";
}

const CHECKLIST_ARRAY_KEYS = new Set([
    "checks",
    "checklist",
    "checklistdata",
    "checklistitems",
    "clientcontractcomponents",
    "components",
    "data",
    "items",
    "results",
    "value"
]);

const CHECK_ID_KEYS = new Set([
    "alacarteid",
    "id",
    "checkid",
    "checktypeid",
    "componentid",
    "clientcontractcomponentid",
    "clientcontractcomponentcode",
    "code",
    "externalcode",
    "serviceid"
]);

const CHECK_NAME_KEYS = new Set([
    "alacartename",
    "checkname",
    "checktitle",
    "checktypename",
    "componentname",
    "clientcontractcomponentname",
    "displayname",
    "name",
    "servicename",
    "title",
    "label",
    "component"
]);

function normalizeKey(key) {
    return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findChecklistArray(value, visited = new Set()) {
    if (Array.isArray(value)) {
        return value;
    }

    if (!value || typeof value !== "object" || visited.has(value)) {
        return null;
    }

    visited.add(value);
    const entries = Object.entries(value);

    for (const [key, child] of entries) {
        if (
            CHECKLIST_ARRAY_KEYS.has(normalizeKey(key)) &&
            Array.isArray(child)
        ) {
            return child;
        }
    }

    for (const [, child] of entries) {
        if (!child || typeof child !== "object" || Array.isArray(child)) {
            continue;
        }

        const items = findChecklistArray(child, visited);
        if (items) {
            return items;
        }
    }

    return null;
}

function findNestedValue(value, acceptedKeys, visited = new Set()) {
    if (!value || typeof value !== "object" || visited.has(value)) {
        return undefined;
    }

    visited.add(value);
    const entries = Object.entries(value);

    for (const [key, child] of entries) {
        if (
            acceptedKeys.has(normalizeKey(key)) &&
            (typeof child === "string" || typeof child === "number") &&
            String(child).trim()
        ) {
            return child;
        }
    }

    for (const [, child] of entries) {
        const result = findNestedValue(child, acceptedKeys, visited);
        if (result !== undefined) {
            return result;
        }
    }

    return undefined;
}

function getCheckListItems(responseData) {
    const items = findChecklistArray(responseData);

    if (!items) {
        throw new Error(
            "Adamma checklist response did not contain a list of checks"
        );
    }

    return items.map((item, index) => {
        if (typeof item === "string" && item.trim()) {
            const name = item.trim();
            return {
                id: name,
                name,
                description: "",
                quantity: 0
            };
        }

        const rawId = findNestedValue(item, CHECK_ID_KEYS);
        const rawName = findNestedValue(item, CHECK_NAME_KEYS);
        const id = rawId ?? rawName;
        const name = rawName ?? rawId;

        if (id === undefined || name === undefined) {
            const fields = item && typeof item === "object"
                ? Object.keys(item).join(", ") || "no fields"
                : typeof item;
            throw new Error(
                `Adamma checklist item at position ${index + 1} has no recognizable ID or name (top-level fields: ${fields})`
            );
        }

        const description = findNestedValue(
            item,
            new Set(["description", "componentdescription", "checkdescription"])
        );
        const rawQuantity = findNestedValue(
            item,
            new Set(["quantity", "count", "defaultquantity"])
        );
        const parsedQuantity = Number(rawQuantity);

        return {
            id: String(id),
            name: String(name),
            description: description === undefined ? "" : String(description),
            quantity: Number.isFinite(parsedQuantity) ? parsedQuantity : 0
        };
    });
}

function findAuthToken(data) {
    if (typeof data === "string" && data.trim()) {
        return data.trim();
    }

    if (!data || typeof data !== "object") {
        return null;
    }

    const tokenKeys = new Set([
        "token",
        "accesstoken",
        "acesstoken",
        "authcode",
        "authorizationcode"
    ]);

    for (const [key, value] of Object.entries(data)) {
        if (
            tokenKeys.has(normalizeKey(key)) &&
            typeof value === "string" &&
            value.trim()
        ) {
            return value.trim();
        }
    }

    for (const value of Object.values(data)) {
        if (value && typeof value === "object") {
            const token = findAuthToken(value);
            if (token) {
                return token;
            }
        }
    }

    return null;
}

async function getCFirstAccessToken() {
    const { userName, password, apiKey, authenticationUrl } = config.cFirst;
    if (!userName || !password || !apiKey) {
        throw new Error(
            "CFIRST_USER_NAME, CFIRST_PASSWORD, and CFIRST_API_KEY must be configured in Backend/.env"
        );
    }
    try {
        const response = await axios.get(authenticationUrl, {
            params: {
                UserName: userName,
                Password: password,
                Apikey: apiKey
            },
            headers: { Accept: "application/json" },
            timeout: CFIRST_REQUEST_TIMEOUT_MS
        });
        const token = findAuthToken(response.data);
        if (!token) {
            throw new Error("cFirst authentication response did not contain an AccessToken");
        }
        return token;
    } catch (error) {
        const failure = new Error(
            `cFirst authentication failed${error.response?.status ? ` (HTTP ${error.response.status})` : ""}`,
            { cause: error }
        );
        failure.status = 502;
        throw failure;
    }
}

async function fetchCFirstPackageList(token) {
    try {
        const response = await axios.get(config.cFirst.packageListUrl, {
            params: { accesstoken: token },
            headers: { Accept: "application/json" },
            timeout: CFIRST_REQUEST_TIMEOUT_MS
        });
        const result = response.data?.GetPackageListResult;
        if (!result || !Array.isArray(result.AlaCarteCheckList)) {
            throw new Error(
                "cFirst GetPackageList response did not contain an AlaCarteCheckList"
            );
        }
        if (result.BGVErrors) {
            throw new Error("cFirst GetPackageList returned a BGV error");
        }

        const checks = result.AlaCarteCheckList
            .filter(check =>
                CFIRST_CHECK_NAMES.has(String(check.CheckName || "").trim().toLowerCase())
            )
            .map(check => ({
                id: String(check.CheckId),
                name: String(check.CheckName),
                description: "",
                quantity: 0
            }));
        const packages = Array.isArray(result.Packages)
            ? result.Packages.map(item => ({
                id: String(item.PackageId),
                name: String(item.PackageName || ""),
                description: String(item.PackageDescription || ""),
                price: String(item.PackagePrice ?? "")
            })).filter(item => item.id && item.name)
            : [];

        return { checks, packages };
    } catch (error) {
        const failure = new Error(
            `cFirst package list request failed${error.response?.status ? ` (HTTP ${error.response.status})` : ""}`,
            { cause: error }
        );
        failure.status = 502;
        throw failure;
    }
}

async function getCFirstCatalog() {
    const { userName, password, apiKey } = config.cFirst;
    if (!userName || !password || !apiKey) {
        return {
            checks: LAST_KNOWN_CFIRST_CHECKS.map(check => ({ ...check })),
            packages: LAST_KNOWN_CFIRST_PACKAGES.map(item => ({ ...item })),
            warning: "Showing the supplied cFirst checks and package list. Configure CFIRST_USER_NAME, CFIRST_PASSWORD, and CFIRST_API_KEY in Backend/.env to refresh the list and submit to cFirst."
        };
    }

    const accessToken = await getCFirstAccessToken();
    return {
        ...await fetchCFirstPackageList(accessToken)
    };
}

async function getVendorCatalog(vendor) {
    if (String(vendor).toLowerCase() === "cfirst") {
        return getCFirstCatalog();
    }

    if (String(vendor).toLowerCase() === "vibrant") {
        if (!config.vibrant.loadChecksFromApi) {
            return {
                checks: getLastKnownVibrantChecks(),
                packages: []
            };
        }

        try {
            return {
                checks: await getVendorChecks(vendor),
                packages: []
            };
        } catch (error) {
            console.warn("Vibrant checks lookup failed, using fallback list", {
                status: error?.cause?.response?.status || error?.response?.status || null,
                message: error?.message || "",
                code: error?.cause?.code || error?.code || ""
            });
            return {
                checks: getLastKnownVibrantChecks(),
                packages: [],
                warning: getVibrantFallbackWarning(error)
            };
        }
    }

    return {
        checks: await getVendorChecks(vendor),
        packages: []
    };
}

async function getAdammaToken() {
    if (!config.vendor.userId || !config.vendor.password) {
        throw new Error(
            "ADAMMA_USER_ID and ADAMMA_PASSWORD must be configured in Backend/.env"
        );
    }

    try {
        const response = await axios.post(
            config.vendor.authUrl,
            {
                userId: config.vendor.userId,
                password: config.vendor.password
            },
            {
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json"
                },
                timeout: ADAMMA_REQUEST_TIMEOUT_MS
            }
        );

        const token = findAuthToken(response.data);
        if (!token) {
            throw new Error(
                "Adamma generateAuthCode response did not contain a token or auth code"
            );
        }

        return token;
    } catch (error) {
        if (error.response) {
            const responseMessage =
                error.response.data?.message ||
                error.response.data?.error?.message ||
                error.response.statusText;
            throw new Error(
                `Adamma token request failed (HTTP ${error.response.status})${responseMessage ? `: ${responseMessage}` : ""}`,
                { cause: error }
            );
        }

        throw error;
    }
}

async function getVibrantToken() {
    const { clientSecret, tokenPayload } = config.vibrant;
    let authPayload = null;
    let tokenPayloadParseFailed = false;

    if (tokenPayload && String(tokenPayload).trim()) {
        try {
            const parsed = JSON.parse(String(tokenPayload));
            if (!parsed || typeof parsed !== "object") {
                throw new Error("invalid JSON object");
            }
            authPayload = parsed;
        } catch {
            tokenPayloadParseFailed = true;
        }
    }

    if (!authPayload && clientSecret) {
        authPayload = { clientSecret };
    }

    if (!authPayload) {
        const error = new Error(
            tokenPayloadParseFailed
                ? "VIBRANT_TOKEN_PAYLOAD is invalid JSON. Use a valid JSON object, for example '{\"clientSecret\":\"...\"}', or set VIBRANT_CLIENT_SECRET."
                : "Vibrant credentials are missing in Backend/.env. Set VIBRANT_CLIENT_SECRET (or VIBRANT_CLIENTSECRET) or VIBRANT_TOKEN_PAYLOAD."
        );
        error.status = 500;
        throw error;
    }

    try {
        const response = await axios.post(
            config.vibrant.tokenUrl,
            authPayload,
            {
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json"
                },
                timeout: VIBRANT_REQUEST_TIMEOUT_MS
            }
        );
        const token = response.data?.apiToken || response.data?.token;
        const success = String(response.data?.success ?? "true").toLowerCase();
        if (!token || success !== "true") {
            throw new Error(
                response.data?.message ||
                "Vibrant token response did not contain apiToken"
            );
        }
        return String(token);
    } catch (error) {
        if (error.response) {
            const responseMessage = getVendorResponseMessage(error.response.data) ||
                error.response.statusText;
            const failure = new Error(
                `Vibrant token request failed (HTTP ${error.response.status})${responseMessage ? `: ${responseMessage}` : ""}`,
                { cause: error }
            );
            failure.status = 502;
            throw failure;
        }
        if (error.status) {
            throw error;
        }
        throw new Error(`Vibrant token request failed: ${error.message}`, { cause: error });
    }
}

function getVibrantChecksFromResponse(data) {
    const candidates = [
        data?.checks,
        data?.data?.checks,
        data?.data,
        data?.packageDetails,
        data?.packages,
        data?.results
    ];
    const list = candidates.find(Array.isArray);
    if (!Array.isArray(list)) {
        throw new Error("Vibrant package details response did not include a checks list");
    }
    return list.map(item => {
        if (typeof item === "string") {
            return { id: item, name: item, description: "", quantity: 0 };
        }
        const name = String(
            item?.name ||
            item?.checkName ||
            item?.check ||
            item?.packageName ||
            item?.title ||
            ""
        ).trim();
        const id = String(item?.id || item?.checkId || name).trim();
        if (!name) {
            throw new Error("Vibrant checks response contains an item without name");
        }
        return {
            id,
            name,
            description: String(item?.description || ""),
            quantity: Number.parseInt(item?.quantity ?? 0, 10) || 0
        };
    });
}

async function fetchVibrantChecks() {
    const apiToken = await getVibrantToken();
    const candidateUrls = [
        config.vibrant.packageDetailsUrl,
        String(config.vibrant.tokenUrl || "").replace(/generate_api_token$/i, "get_package_details"),
        String(config.vibrant.tokenUrl || "").replace("/fractal/", "/infinite/").replace(/generate_api_token$/i, "get_package_details"),
        String(config.vibrant.tokenUrl || "").replace("/infinite/", "/fractal/").replace(/generate_api_token$/i, "get_package_details")
    ]
        .map(item => String(item || "").trim())
        .filter(Boolean)
        .filter((value, index, self) => self.indexOf(value) === index);

    let lastError = null;
    for (const url of candidateUrls) {
        try {
            const response = await axios.post(
                url,
                {},
                {
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                        apiToken
                    },
                    timeout: VIBRANT_REQUEST_TIMEOUT_MS
                }
            );
            return getVibrantChecksFromResponse(response.data);
        } catch (error) {
            lastError = error;
            const status = error.response?.status || 0;
            if (status === 404) {
                continue;
            }
            if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
                continue;
            }
            if (!error.response) {
                continue;
            }
            break;
        }
    }

    try {
        if (!lastError) {
            throw new Error("No Vibrant package details URL is configured");
        }
        throw lastError;
    } catch (error) {
        if (error.response) {
            const responseMessage = getVendorResponseMessage(error.response.data) ||
                error.response.statusText;
            const failure = new Error(
                `Vibrant package details request failed (HTTP ${error.response.status})${responseMessage ? `: ${responseMessage}` : ""}`,
                { cause: error }
            );
            failure.status = 502;
            throw failure;
        }
        if (error.status) {
            throw error;
        }
        throw new Error(`Vibrant package details request failed: ${error.message}`, { cause: error });
    }
}

async function getVendorChecks(vendor) {
    if (String(vendor).toLowerCase() === "cfirst") {
        return (await getCFirstCatalog()).checks;
    }

    if (String(vendor).toLowerCase() === "parishram") {
        return getLastKnownParishramChecks();
    }

    if (String(vendor).toLowerCase() === "vibrant") {
        return fetchVibrantChecks();
    }

    if (String(vendor).toLowerCase() !== "adamma") {
        return [];
    }

    if (checklistCache && Date.now() < checklistCacheExpiresAt) {
        return checklistCache;
    }

    const request = checklistRequestInFlight || (checklistRequestInFlight = fetchVendorChecks());

    try {
        checklistCache = await request;
        checklistCacheExpiresAt = Date.now() + CHECKLIST_CACHE_TTL_MS;
        return checklistCache;
    } catch (error) {
        if (error.response) {
            const responseMessage =
                error.response.data?.message ||
                error.response.data?.error?.message ||
                error.response.statusText;
            throw new Error(
                `Adamma checklist request failed (HTTP ${error.response.status})${responseMessage ? `: ${responseMessage}` : ""}`,
                { cause: error }
            );
        }

        if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
            throw new Error("Adamma checks request timed out after 45 seconds. Please retry.", { cause: error });
        }

        throw error;
    } finally {
        if (checklistRequestInFlight === request) {
            checklistRequestInFlight = null;
        }
    }
}

async function fetchVendorChecks() {
    const token = await getAdammaToken();
    const response = await axios.get(config.vendor.checklistUrl, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json"
        },
        timeout: ADAMMA_REQUEST_TIMEOUT_MS
    });

    return getCheckListItems(response.data);
}

function cFirstText(value) {
    if (value === undefined || value === null) return "";
    const text = String(value).trim();
    return text === "-" ? "" : text;
}

function formatCFirstDate(value) {
    if (!value) return null;
    const text = String(value);
    if (/^\d{4}$/.test(text)) return text;

    const successFactorsDate = text.match(/^\/Date\((-?\d+)/);
    const date = successFactorsDate
        ? new Date(Number(successFactorsDate[1]))
        : new Date(text);
    if (Number.isNaN(date.getTime())) return text;

    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${date.getUTCFullYear()}`;
}

function formatCFirstDateOfBirth(value) {
    if (!value) return null;
    const successFactorsDate = String(value).match(/^\/Date\((-?\d+)/);
    const date = successFactorsDate
        ? new Date(Number(successFactorsDate[1]))
        : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = date.toLocaleString("en", {
        month: "short",
        timeZone: "UTC"
    });
    return `${day}-${month}-${date.getUTCFullYear()}`;
}

function getSlotValue(record, field, index) {
    return record[`${field}${index}`];
}

function mapCFirstEmployments(records) {
    return records.flatMap(record =>
        Array.from({ length: 4 }, (_, index) => {
            const slot = index + 1;
            const employer = getSlotValue(record, "cust_NameofEmployer", slot);
            const employment = {
                Employer: cFirstText(employer),
                Designation: cFirstText(getSlotValue(record, "cust_EMPDesignation", slot)),
                Country: cFirstText(getSlotValue(record, "cust_Country", slot)),
                State: cFirstText(getSlotValue(record, "cust_State", slot)),
                City: cFirstText(getSlotValue(record, "cust_City", slot)),
                StartDate: formatCFirstDate(getSlotValue(record, "cust_From", slot)),
                EndDate: formatCFirstDate(getSlotValue(record, "cust_To", slot)),
                RMName: cFirstText(getSlotValue(record, "cust_ManagerName", slot)),
                RMDesignation: "",
                RMEmail: cFirstText(getSlotValue(record, "cust_ManagerEmail", slot)),
                RMPhone: cFirstText(getSlotValue(record, "cust_ManagerNo", slot)),
                OkToCall: ""
            };

            return employment.Employer ||
                employment.Designation ||
                employment.StartDate ||
                employment.EndDate
                ? employment
                : null;
        }).filter(Boolean)
    ).slice(0, 4);
}

function mapCFirstEducations(records) {
    return records.flatMap(record =>
        Array.from({ length: 5 }, (_, index) => {
            const slot = index + 1;
            const education = {
                School: cFirstText(record[`cust_NameofInstitute${slot}`]),
                University: cFirstText(record[`cust_NameofUniversity${slot}`]),
                Country: "",
                CountryCode: "",
                State: "",
                City: "",
                Degree: cFirstText(record[`cust_Qualification${slot}`]),
                Major: cFirstText(record[`cust_Specialization${slot}`]),
                StartDate: null,
                EndDate: formatCFirstDate(record[`cust_Year${slot}`])
            };

            return education.School ||
                education.University ||
                education.Degree ||
                education.Major
                ? education
                : null;
        }).filter(Boolean)
    ).slice(0, 5);
}

function mapCFirstAddresses(records) {
    return records.map(record => {
        const parts = [
            record.address1,
            record.address2,
            record.address3
        ].map(cFirstText).filter(Boolean);
        return {
            Address: parts.join(", "),
            City: cFirstText(record.city),
            State: cFirstText(record.state),
            Country: cFirstText(record.country || record.county),
            CountryCode: cFirstText(record.country),
            PostalCode: cFirstText(record.zipCode),
            StartDate: formatCFirstDate(record.startDate),
            EndDate: formatCFirstDate(record.endDate)
        };
    }).filter(address =>
        address.Address || address.City || address.State ||
        address.Country || address.PostalCode
    );
}

function mapCFirstAttachments(documents) {
    return documents.map((document, index) => {
        const extension = getCFirstAttachmentType(document);
        return {
            AttachmentId: index + 1,
            AttachmentType: extension,
            AttachmentName: document.fileName || document.file,
            AttachmentBody: document.fileContent.replace(/\s/g, "")
        };
    });
}

function normalizeAttachmentType(value) {
    if (!value) return "";
    return String(value)
        .trim()
        .replace(/^\./, "")
        .split(/[;\s]/)[0]
        .toLowerCase();
}

function getCFirstAttachmentType(document) {
    const fromFileExtension = normalizeAttachmentType(document.fileExtension);
    if (fromFileExtension) {
        return fromFileExtension;
    }

    const fromFileName = normalizeAttachmentType(document.fileName?.split(".").pop());
    if (fromFileName) {
        return fromFileName;
    }

    const mimeSubType = String(document.mimeType || "").split("/").pop();
    return normalizeAttachmentType(mimeSubType);
}

function sanitizeCFirstAttachments(documents) {
    const accepted = [];
    const skipped = [];
    const seenByContent = new Set();

    for (const document of documents) {
        const attachmentType = getCFirstAttachmentType(document);

        if (!CFIRST_ALLOWED_ATTACHMENT_TYPES.has(attachmentType)) {
            skipped.push({
                name: document.fileName || document.file || "Unnamed attachment",
                reason: `unsupported file type (${attachmentType || "unknown"})`
            });
            continue;
        }

        const body = String(document.fileContent || "").replace(/\s/g, "");
        if (!body) {
            skipped.push({
                name: document.fileName || document.file || "Unnamed attachment",
                reason: "empty file content"
            });
            continue;
        }

        let bytes = 0;
        try {
            bytes = Buffer.from(body, "base64").byteLength;
        } catch {
            skipped.push({
                name: document.fileName || document.file || "Unnamed attachment",
                reason: "invalid base64 content"
            });
            continue;
        }

        // No size limit unless CFIRST_MAX_ATTACHMENT_BYTES is set in .env.
        if (config.cFirst.maxAttachmentBytes > 0 && bytes > config.cFirst.maxAttachmentBytes) {
            skipped.push({
                name: document.fileName || document.file || "Unnamed attachment",
                reason: `file size ${Math.ceil(bytes / 1024)}KB exceeds configured limit`
            });
            continue;
        }

        const duplicateKey = `${attachmentType}:${body}`;
        if (seenByContent.has(duplicateKey)) {
            skipped.push({
                name: document.fileName || document.file || "Unnamed attachment",
                reason: "duplicate attachment content"
            });
            continue;
        }
        seenByContent.add(duplicateKey);

        accepted.push({
            ...document,
            cFirstAttachmentType: attachmentType,
            fileContent: body
        });
    }

    return {
        accepted,
        skipped
    };
}

function buildCFirstCandidate(source, selectedPackage, selectedChecks, selectedFiles) {
    const employee = source.employee;
    const personal = source.personal;
    const responseEmail = source.responseEmail;
    const experience = source.employments
        .map(record => record.cust_Doyouhaveexperienceworkingwithanothercompany)
        .find(value => value !== undefined && value !== null);
    const emailAddress =
        responseEmail.emailAddress ||
        responseEmail.email ||
        responseEmail.emailId ||
        null;

    return {
        PackageName: selectedPackage.name,
        PackageId: selectedPackage.id,
        APIReferenceCode: `BGV-${randomUUID()}`,
        BGCResponseEmailIds: emailAddress,
        EmployeeId: source.externalCode,
        FirstName: cFirstText(personal.firstName),
        MiddleName: cFirstText(personal.middleName),
        LastName: cFirstText(personal.lastName),
        Email: cFirstText(employee.cust_CandidateEmail),
        DateOfBirth: formatCFirstDateOfBirth(employee.cust_DOB),
        Phone: cFirstText(employee.cust_PhoneNumber),
        SSN: cFirstText(
            employee.cust_Aadharnumber ||
            employee.cust_AadhaarNumber ||
            employee.cust_PANNumber
        ),
        PrevEmployed: String(experience || "").toUpperCase() === "Y"
            ? "Yes"
            : String(experience || "").toUpperCase() === "N"
                ? "No"
                : null,
        AlaCarteChecks: selectedChecks.map(check => ({
            CheckId: /^\d+$/.test(String(check.id)) ? Number(check.id) : check.id,
            Quantity: Math.max(1, Number.parseInt(check.quantity, 10) || 1),
            Remarks: cFirstText(check.description)
        })),
        Alias: [],
        MetaAddress: mapCFirstAddresses(source.addresses),
        Employments: mapCFirstEmployments(source.employments),
        Educations: mapCFirstEducations(source.educations),
        Reference: [],
        Licenses: [],
        Attachments: mapCFirstAttachments(selectedFiles)
    };
}

function wait(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function isRetryableCFirstError(error) {
    const status = error.response?.status;
    if (status === 502 || status === 503 || status === 504) {
        return true;
    }
    return CFIRST_RETRYABLE_NETWORK_CODES.has(error.code);
}

function summarizeCFirstBgvErrors(bgvErrors) {
    if (Array.isArray(bgvErrors)) {
        const messages = bgvErrors
            .map(item => {
                if (typeof item === "string") return item.trim();
                if (!item || typeof item !== "object") return "";
                return (
                    // cFirst's own shape: { Error, Errorcode, Errordescription }
                    item.Errordescription ||
                    item.ErrorDescription ||
                    item.Error ||
                    item.ErrorMessage ||
                    item.Message ||
                    item.Description ||
                    item.detail ||
                    item.error ||
                    ""
                ).toString().trim();
            })
            .filter(Boolean);
        return messages.join("; ");
    }
    if (typeof bgvErrors === "string") {
        return bgvErrors.trim();
    }
    if (bgvErrors && typeof bgvErrors === "object") {
        return getVendorResponseMessage(bgvErrors);
    }
    return "";
}

function getCFirstErrorDebugInfo(error) {
    const payload = error.response?.data;
    let responseSnippet = "";
    if (payload !== undefined) {
        if (typeof payload === "string") {
            responseSnippet = payload.slice(0, 2000);
        } else {
            try {
                responseSnippet = JSON.stringify(payload).slice(0, 2000);
            } catch {
                responseSnippet = "";
            }
        }
    }
    return {
        status: error.response?.status || null,
        code: error.code || "",
        hasResponse: Boolean(error.response),
        responseSnippet
    };
}

async function addCFirstCandidate(accessToken, candidate) {
    const retries = Math.max(0, config.cFirst.addCandidateRetryCount || 0);
    const retryDelayMs = Math.max(0, config.cFirst.addCandidateRetryDelayMs || 0);
    let lastError = null;

    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
        try {
            return await axios.post(
                config.cFirst.addCandidateUrl,
                {
                    accesstoken: accessToken,
                    Candidatejson: JSON.stringify([candidate])
                },
                {
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json"
                    },
                    timeout: config.cFirst.addCandidateTimeoutMs,
                    maxBodyLength: Infinity,
                    maxContentLength: Infinity
                }
            );
        } catch (error) {
            lastError = error;
            if (attempt > retries || !isRetryableCFirstError(error)) {
                throw error;
            }
            console.warn("cFirst AddCandidate transient failure; retrying", {
                attempt,
                retries,
                code: error.code,
                status: error.response?.status
            });
            if (retryDelayMs > 0) {
                await wait(retryDelayMs);
            }
        }
    }

    throw lastError;
}

async function initiateCFirstBGC(payload) {
    const accessToken = await getCFirstAccessToken();
    const catalog = await fetchCFirstPackageList(accessToken);
    const selectedPackage = catalog.packages.find(item =>
        item.id === String(payload.packageId) &&
        item.name === String(payload.packageName)
    );
    if (!selectedPackage) {
        const error = new Error("Select a valid cFirst package before submitting");
        error.status = 400;
        throw error;
    }

    const knownCheckIds = new Set(catalog.checks.map(check => check.id));
    if (payload.selectedChecks.some(check => !knownCheckIds.has(String(check.id)))) {
        const error = new Error("One or more selected checks are not available from cFirst");
        error.status = 400;
        throw error;
    }

    const [source, educationDocuments, additionalResult] = await Promise.all([
        getCFirstCandidateSourceData(
            payload.employeeId,
            payload.educationRecordId,
            payload.previousEmploymentId
        ),
        getEducationAttachments(payload.educationRecordId),
        getAdditionalAttachments(
            payload.personIdExternal,
            payload.previousEmploymentId,
            payload.educationRecordId
        )
    ]);
    const availableDocuments = [
        ...educationDocuments,
        ...additionalResult.documents
    ];
    const requestedIds = new Set(payload.selectedDocs.map(String));
    const selectedFiles = availableDocuments.filter(document =>
        requestedIds.has(String(document.id))
    );
    if (selectedFiles.length !== requestedIds.size) {
        const error = new Error(
            "One or more selected files are no longer available for this employee"
        );
        error.status = 400;
        throw error;
    }

    const missingFile = selectedFiles.find(document => !document.fileContent);
    if (missingFile) {
        const error = new Error(
            `SuccessFactors did not return file content for ${missingFile.fileName}`
        );
        error.status = 400;
        throw error;
    }

    // All selected documents go to cFirst, previous-employment ones included:
    // cFirst's API document lists "Relieving Letter, Experience Letter" as
    // attachment types and sets no file size limit.
    const { accepted: filesToSend, skipped: skippedFiles } =
        sanitizeCFirstAttachments(selectedFiles);
    if (filesToSend.length === 0) {
        const reasons = skippedFiles
            .map(item => `${item.name}: ${item.reason}`)
            .join("; ");
        const error = new Error(
            `No supported attachments are available for cFirst. ${reasons}`
        );
        error.status = 400;
        throw error;
    }

    const candidate = buildCFirstCandidate(
        source,
        selectedPackage,
        payload.selectedChecks,
        filesToSend
    );

    try {
        const response = await addCFirstCandidate(accessToken, candidate);
        const bgvErrors =
            response.data?.AddCandidateResult?.BGVErrors ||
            response.data?.BGVErrors;
        if (bgvErrors && (!Array.isArray(bgvErrors) || bgvErrors.length > 0)) {
            const details = summarizeCFirstBgvErrors(bgvErrors);
            const rejection = new Error(
                `cFirst AddCandidate rejected the payload${details ? `: ${details}` : ""}`
            );
            rejection.status = 400;
            rejection.stage = "cfirst-add-candidate-response-validation";
            rejection.vendorMessage = details;
            throw rejection;
        }
        const filteredOut =
            selectedFiles.length - filesToSend.length - skippedFiles.length;
        const attachmentMessage = [
            `Sent ${filesToSend.length} attachment(s).`,
            skippedFiles.length > 0
                ? `Skipped attachments: ${skippedFiles.map(item => `${item.name} (${item.reason})`).join(", ")}.`
                : null,
            filteredOut > 0
                ? `Skipped ${filteredOut} duplicate attachment(s).`
                : null
        ].filter(Boolean).join(" ");

        // The candidate now exists in cFirst: read its status once and update SF,
        // like Adamma and Parishram. A failed status read does not undo the case.
        const { candidateId, refId: addCandidateRefId, profileNumber: addCandidateProfileNumber } =
            getCFirstCaseIds(response.data);
        let caseStatus = null;
        if (candidateId) {
            try {
                caseStatus = await getCFirstCaseStatus(candidateId, addCandidateRefId);
            } catch (statusError) {
                console.warn("cFirst status after AddCandidate failed", {
                    candidateId,
                    message: statusError.message
                });
            }
        }
        const finished = await finishVendorInitiation({
            vendorLabel: "cFirst",
            employeeId: payload.employeeId,
            caseId: candidateId,
            status: "INITIATED",
            vendorStatus: caseStatus?.vendorStatus || "Initiated",
            color: caseStatus?.color,
            remarks: caseStatus?.remarks?.length ? caseStatus.remarks : [`cFirst: ${selectedPackage?.name || "INITIATED"}`],
            initiationDate: new Date().toISOString(),
            fallbackMessage: "Candidate submitted to cFirst.",
            vendorResponse: response.data
        });
        if (candidateId) {
            rememberVendorCase(payload.employeeId, {
                vendor: "cfirst",
                caseId: candidateId,
                refId: addCandidateRefId || caseStatus?.refId || "",
                profileNumber: addCandidateProfileNumber || caseStatus?.profileNumber || ""
            });
        }
        return {
            ...finished,
            // Shown in the footer as "cFirst Ref ID" and sent again on Refresh
            refId: addCandidateRefId || caseStatus?.refId || "",
            profileNumber: addCandidateProfileNumber || caseStatus?.profileNumber || "",
            message: `${finished.message} ${attachmentMessage}`.trim()
        };
    } catch (error) {
        if (error.status) {
            throw error;
        }

        if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
            const timeoutSeconds = Math.round(config.cFirst.addCandidateTimeoutMs / 1000);
            const failure = new Error(
                `cFirst AddCandidate timed out after ${timeoutSeconds} seconds. Try again or increase CFIRST_ADD_CANDIDATE_TIMEOUT_MS in Backend/.env.`,
                { cause: error }
            );
            failure.status = 504;
            failure.stage = "cfirst-add-candidate-api";
            failure.vendorCode = error.code || "";
            throw failure;
        }

        const responseMessage = error.response
            ? getVendorResponseMessage(error.response.data)
            : "";
        const networkCode = !error.response && error.code
            ? ` (${error.code})`
            : "";
        const noResponseHint = !error.response
            ? "No HTTP response from cFirst."
            : "";
        const details = [responseMessage, noResponseHint].filter(Boolean).join(" ");
        const failure = new Error(
            `cFirst AddCandidate request failed${networkCode}${error.response?.status ? ` (HTTP ${error.response.status})` : ""}${details ? `: ${details}` : ""}`,
            { cause: error }
        );
        failure.status = 502;
        failure.stage = "cfirst-add-candidate-api";
        failure.vendorStatus = error.response?.status;
        failure.vendorCode = error.code || "";
        failure.vendorMessage = details;
        failure.vendorDebug = getCFirstErrorDebugInfo(error);
        throw failure;
    }
}

function parishramValue(value) {
    if (value === undefined || value === null) return "";
    const normalized = String(value).trim();
    return normalized === "-" ? "" : normalized;
}

function parishramRequired(value, fallback = "NA") {
    const normalized = parishramValue(value);
    return normalized || fallback;
}

async function getSelectedDocumentsForSubmission(payload) {
    const requestedIds = new Set((payload.selectedDocs || []).map(String));
    if (requestedIds.size === 0) {
        return [];
    }

    const [educationDocuments, additionalResult] = await Promise.all([
        getEducationAttachments(payload.educationRecordId),
        getAdditionalAttachments(
            payload.personIdExternal,
            payload.previousEmploymentId,
            payload.educationRecordId
        )
    ]);
    const availableDocuments = [...educationDocuments, ...additionalResult.documents];

    const selectedFiles = availableDocuments.filter(document =>
        requestedIds.has(String(document.id))
    );
    if (selectedFiles.length !== requestedIds.size) {
        const error = new Error("One or more selected files are no longer available for this employee");
        error.status = 400;
        throw error;
    }

    const missingFile = selectedFiles.find(document => !document.fileContent);
    if (missingFile) {
        const error = new Error(`SuccessFactors did not return file content for ${missingFile.fileName}`);
        error.status = 400;
        throw error;
    }

    return selectedFiles;
}

function buildParishramCasePayload(payload) {
    const candidate = payload.candidateInfo || {};
    const checks = payload.selectedChecks
        .map(check => String(check.name || check.id || "").trim())
        .filter(Boolean);

    const body = {
        userId: String(config.parishram.userId || config.parishram.userName || ""),
        checks
    };
    const candidateName = parishramRequired(candidate.name);
    const candidateDob = parishramRequired(formatAdammaIsoDate(candidate.dob), "1990-01-01");
    const candidateFatherName = parishramRequired(candidate.fatherName);
    const candidatePhone = parishramRequired(candidate.phone);
    const candidateEmail = parishramRequired(candidate.email);
    const candidatePan = parishramRequired(candidate.panNumber);
    const employeeCode = parishramRequired(candidate.employeeId || payload.employeeId);

    for (const checkName of checks) {
        if (checkName === "Employment Credential Check") {
            body[checkName] = {
                employerName: parishramRequired(candidate.project || candidate.client),
                designation: "Employee",
                tenure: "1 Years",
                employeeCode,
                rmName: parishramRequired(candidate.managerName || candidate.fatherName),
                rmNumber: candidatePhone,
                hrName: parishramRequired(candidate.managerName || "HR Team"),
                hrNumberMailId: candidateEmail
            };
        } else if (checkName === "Educational Qualification Check") {
            body[checkName] = {
                universityName: parishramRequired(candidate.project || "Unknown University"),
                yearOfPassing: parishramRequired(formatAdammaIsoDate(candidate.joiningDate).slice(0, 4), "2020"),
                collegeName: parishramRequired(candidate.client || "Unknown College"),
                registrationEnrollmentNo: employeeCode,
                rollNumber: employeeCode
            };
        } else if (checkName === "Criminal Verification through Court Record Check") {
            body[checkName] = {
                name: candidateName,
                dob: candidateDob,
                fathersName: candidateFatherName,
                address: parishramRequired(candidate.client)
            };
        } else if (checkName === "Digital Residential Address Check") {
            body[checkName] = {
                addressType: "Current",
                modeOfVerification: "Digital",
                completeAddress: parishramRequired(candidate.client),
                city: parishramRequired(candidate.client),
                state: parishramRequired("Unknown"),
                pinCode: "000000",
                landmark: "NA",
                contactNo: candidatePhone,
                residentialType: "Rented",
                tenure: "1 Years",
                alternateNo: candidatePhone
            };
        } else if (checkName === "Global Database Check") {
            body[checkName] = {
                name: candidateName,
                dob: candidateDob,
                fathersName: candidateFatherName,
                gender: parishramRequired(candidate.gender || "NA"),
                address: parishramRequired(candidate.client)
            };
        } else if (checkName === "Directorship Check") {
            body[checkName] = {
                name: candidateName,
                employerName: parishramRequired(candidate.project || candidate.client),
                dob: candidateDob,
                panCardOfDirector: candidatePan
            };
        } else if (checkName === "Social Media Check") {
            body[checkName] = {
                name: candidateName,
                personalEmailId: candidateEmail,
                photo: "",
                contactNumber: candidatePhone
            };
        } else if (checkName === "CIBIL Check / Consumer credit") {
            body[checkName] = {
                name: candidateName,
                dob: candidateDob,
                panCardNumber: candidatePan,
                fathersName: candidateFatherName,
                address: parishramRequired(candidate.client),
                contactNumber: candidatePhone
            };
        } else if (checkName === "Credit & Bankruptcy Check") {
            body[checkName] = {
                name: candidateName,
                dob: candidateDob,
                fathersName: candidateFatherName
            };
        } else if (checkName === "Reputational media") {
            body[checkName] = {
                name: candidateName,
                dob: candidateDob,
                fathersName: candidateFatherName,
                contactNumber: candidatePhone,
                mailId: candidateEmail
            };
        } else if (checkName === "Civil litigation") {
            body[checkName] = {
                name: candidateName,
                dob: candidateDob,
                fathersName: candidateFatherName,
                address: parishramRequired(candidate.client)
            };
        } else if (checkName === "Banned/Disqualified persons") {
            body[checkName] = {
                name: candidateName,
                dob: candidateDob,
                fathersName: candidateFatherName
            };
        }
    }

    return body;
}
    
// Parishram CaseInitiate takes each document as a Base64 string in a fixed
// JSON key. Every key is always sent ("" when there is no document).
const PARISHRAM_DOCUMENT_KEYS = [
    "panCard",
    "aadhaarCard",
    "marksheet",
    "relievingLetter1",
    "paySlip1",
    "relievingLetter2",
    "paySlip2",
    "rentAgreement",
    "bgvForm"
];

// Which Parishram keys a document may go into, best match first.
function getParishramDocumentKeys(document) {
    const name = [document.cardType, document.type, document.fileName, document.file]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    const section = String(document.section || "").toLowerCase();

    if (/\bpan\b|pan[\s_-]?card/.test(name) || String(document.cardType || "").toUpperCase() === "PAN") {
        return ["panCard"];
    }
    if (/aadh?aa?r|\badn\b|\buid\b/.test(name) || String(document.cardType || "").toUpperCase() === "ADN") {
        return ["aadhaarCard"];
    }
    if (/rent/.test(name)) return ["rentAgreement"];
    if (/bgv|authori[sz]ation|consent/.test(name)) return ["bgvForm"];
    if (/pay\s?slip|payslip|salary/.test(name)) return ["paySlip1", "paySlip2"];
    if (/reliev|experience|exp[\s_-]?letter/.test(name)) return ["relievingLetter1", "relievingLetter2"];
    if (/marks|degree|certificate|transcript/.test(name) || section.includes("education")) {
        return ["marksheet"];
    }
    if (section.includes("employment")) {
        return ["relievingLetter1", "relievingLetter2", "paySlip1", "paySlip2"];
    }
    return [];
}

// Puts the selected SF documents into Parishram's document keys.
// A document with no free matching key is reported as not sent.
function mapParishramDocuments(documents) {
    const fields = Object.fromEntries(PARISHRAM_DOCUMENT_KEYS.map(key => [key, ""]));
    const sent = [];
    const skipped = [];

    for (const document of documents) {
        const name = document.fileName || document.file || "Unnamed attachment";
        const body = String(document.fileContent || "").replace(/\s/g, "");
        if (!body) {
            skipped.push({ name, reason: "empty file content" });
            continue;
        }
        const candidates = getParishramDocumentKeys(document);
        const key = candidates.find(candidate => !fields[candidate]);
        if (!key) {
            skipped.push({
                name,
                reason: candidates.length
                    ? `Parishram takes only one file for ${candidates.join("/")}`
                    : "no matching Parishram document type"
            });
            continue;
        }
        fields[key] = body;
        sent.push({ name, key });
    }

    return { fields, sent, skipped };
}

async function getParishramToken() {
    const { userName, password, tokenUrl, loginPayload } = config.parishram;
    let authPayload = null;
    let loginPayloadParseFailed = false;

    if (loginPayload && String(loginPayload).trim()) {
        try {
            const parsed = JSON.parse(String(loginPayload));
            if (!parsed || typeof parsed !== "object") {
                throw new Error("invalid JSON object");
            }
            authPayload = parsed;
        } catch {
            loginPayloadParseFailed = true;
        }
    }

    if (!authPayload && userName && password) {
        authPayload = {
            userName,
            password
        };
    }

    if (!authPayload) {
        const error = new Error(
            loginPayloadParseFailed
                ? "PARISHRAM_LOGIN_PAYLOAD is invalid JSON. If it contains # or special characters, wrap the full value in single quotes, or set PARISHRAM_USER_NAME and PARISHRAM_PASSWORD instead."
                : "Parishram credentials are missing in Backend/.env. Set PARISHRAM_LOGIN_PAYLOAD or PARISHRAM_USER_NAME/PARISHRAM_PASSWORD."
        );
        error.status = 500;
        throw error;
    }

    try {
        const response = await axios.post(
            tokenUrl,
            authPayload,
            {
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json"
                },
                timeout: PARISHRAM_REQUEST_TIMEOUT_MS
            }
        );
        const token = findAuthToken(response.data) || response.data?.token;
        if (!token || response.data?.status === false) {
            throw new Error(
                response.data?.message ||
                "Parishram token generation response did not contain a token"
            );
        }
        return String(token);
    } catch (error) {
        if (error.response) {
            const responseMessage = getVendorResponseMessage(error.response.data) ||
                error.response.statusText;
            const failure = new Error(
                `Parishram token request failed (HTTP ${error.response.status})${responseMessage ? `: ${responseMessage}` : ""}`,
                { cause: error }
            );
            failure.status = 502;
            throw failure;
        }
        if (error.status) {
            throw error;
        }
        throw new Error(`Parishram token request failed: ${error.message}`, { cause: error });
    }
}

async function submitParishramBGC(payload) {
    const checks = payload.selectedChecks
        .map(check => String(check.name || check.id || "").trim())
        .filter(Boolean);
    if (checks.length === 0) {
        const error = new Error("Please select at least one Parishram check");
        error.status = 400;
        throw error;
    }

    const selectedFiles = await getSelectedDocumentsForSubmission(payload);
    const documents = mapParishramDocuments(selectedFiles);
    const token = await getParishramToken();
    const requestBody = {
        ...buildParishramCasePayload(payload),
        ...documents.fields
    };
    const attachmentMessage = [
        documents.sent.length
            ? `Sent ${documents.sent.length} document(s): ${documents.sent.map(item => `${item.name} as ${item.key}`).join(", ")}.`
            : "",
        documents.skipped.length
            ? `Not sent: ${documents.skipped.map(item => `${item.name} (${item.reason})`).join(", ")}.`
            : ""
    ].filter(Boolean).join(" ");
    const response = await fetch(config.parishram.caseInitiateUrl, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
    });

    const responseText = await response.text();
    let responseData = null;
    try {
        responseData = responseText ? JSON.parse(responseText) : null;
    } catch {
        responseData = null;
    }

    if (!response.ok) {
        const responseMessage = getVendorResponseMessage(responseData) ||
            responseText.slice(0, 1000) ||
            response.statusText;
        const failure = new Error(
            `Parishram case initiation failed (HTTP ${response.status})${responseMessage ? `: ${responseMessage}` : ""}`
        );
        failure.status = 502;
        throw failure;
    }

    if (responseData?.status === false) {
        const error = new Error(
            `Parishram case initiation failed${responseData?.message ? `: ${responseData.message}` : ""}`
        );
        error.status = 502;
        throw error;
    }

    const caseId = String(responseData?.caseId || responseData?.clientReferenceNumber || "");

    // Parishram's initiate response has no status; read it once from CheckStatus
    // so the footer shows Parishram's own words (e.g. "Pending").
    let vendorStatus = "";
    let color = "";
    let remarks = [];
    if (caseId) {
        try {
            const caseStatus = await getParishramCaseStatus(caseId);
            vendorStatus = caseStatus.vendorStatus;
            color = caseStatus.color;
            remarks = caseStatus.remarks;
        } catch (error) {
            console.warn("Parishram CheckStatus after initiation failed", { caseId, message: error.message });
        }
    }

    const finished = await finishVendorInitiation({
        vendorLabel: "Parishram",
        employeeId: payload.employeeId,
        caseId,
        status: "INITIATED",
        // Parishram does not return a date; the case is created at submission.
        initiationDate: new Date().toISOString(),
        vendorStatus,
        color,
        remarks,
        fallbackMessage: responseData?.message || "Case initiated successfully.",
        vendorResponse: responseData || responseText
    });
    return {
        ...finished,
        message: `${finished.message} ${attachmentMessage}`.trim()
    };
}

async function submitVibrantBGC(payload) {
    const candidate = payload.candidateInfo || {};
    const apiToken = await getVibrantToken();
    const now = new Date();
    const caseRef = `${config.vibrant.clientRefNoPrefix}${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}`;
    const requestBody = {
        clientEntityName: config.vibrant.clientEntityName,
        clientRefNo: caseRef,
        candidateName: parishramValue(candidate.name),
        candidateEmailId: parishramValue(candidate.email),
        candidateMobileNo: parishramValue(candidate.phone),
        candidateAltMobileNo: "",
        candidateDOB: formatAdammaIsoDate(candidate.dob),
        candidateGender: parishramValue(candidate.gender),
        maritalStatus: "",
        fathersName: parishramValue(candidate.fatherName),
        nationality: "",
        candidatePAN: parishramValue(candidate.panNumber),
        candidateAadhar: parishramValue(candidate.aadhaarNumber),
        tempEmpId: "",
        empId: parishramValue(candidate.employeeId || payload.employeeId),
        empGrade: "",
        empstatus: "",
        officialEmailId: parishramValue(candidate.email),
        joiningDate: formatAdammaIsoDate(candidate.joiningDate),
        offerAcceptDate: "",
        initiatorName: config.vibrant.initiatorName,
        priorityCase: config.vibrant.priorityCase
    };

    try {
        const response = await axios.post(
            config.vibrant.initiateCaseUrl,
            requestBody,
            {
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    apiToken
                },
                timeout: 60000
            }
        );
        const success = String(response.data?.success ?? "true").toLowerCase();
        if (success !== "true") {
            const error = new Error(
                `Vibrant case initiation failed${response.data?.message ? `: ${response.data.message}` : ""}`
            );
            error.status = 502;
            throw error;
        }

        return {
            success: true,
            message: response.data?.message || "Case initiated successfully.",
            vendorResponse: response.data
        };
    } catch (error) {
        if (error.response) {
            const responseMessage = getVendorResponseMessage(error.response.data) ||
                error.response.statusText;
            const failure = new Error(
                `Vibrant case initiation failed (HTTP ${error.response.status})${responseMessage ? `: ${responseMessage}` : ""}`,
                { cause: error }
            );
            failure.status = 502;
            throw failure;
        }
        if (error.status) {
            throw error;
        }
        throw new Error(`Vibrant case initiation failed: ${error.message}`, { cause: error });
    }
}

function lookupMapped(map, key) {
    const wanted = String(key || "").trim().toLowerCase();
    if (!wanted || !map) return "";
    const entry = Object.entries(map).find(([name]) => name.trim().toLowerCase() === wanted);
    return entry ? String(entry[1]) : "";
}

// Adamma registers our clients from SuccessFactors (Adamma clarification
// document, point 2): clientName = cust_PrimaryProject,
// subclientName = cust_SecondaryProject. A name Adamma has not registered yet
// returns 404 "Client not found".
// Order: per-client map -> fixed name from .env (UAT: "Test") -> SF value.
function resolveAdammaClientNames(candidate) {
    const sfClient = parishramValue(candidate.project);
    const sfSubclient = parishramValue(candidate.secondaryProject);
    return {
        clientName:
            lookupMapped(config.vendor.clientMap, sfClient) ||
            config.vendor.clientName ||
            sfClient,
        subclientName:
            lookupMapped(config.vendor.subclientMap, sfSubclient) ||
            config.vendor.subclientName ||
            sfSubclient
    };
}

function getAdammaCaseId(data) {
    const value = data?.caseID ?? data?.caseId ?? data?.caseid ?? data?.data?.caseID ?? data?.data?.caseId;
    return value === undefined || value === null ? "" : String(value);
}

// Adamma gives a grading colour per check (checkDetails[].gradingColor),
// empty until the check is graded.
// Adamma's remark per check: checkDetails[].description (e.g. "Data Entry Completed").
function getAdammaRemarks(data) {
    const details = Array.isArray(data?.checkDetails) ? data.checkDetails : [];
    return [data?.remarks, ...details.map(check => check?.description || check?.gradingRemarks)];
}

// GetCaseData lists each component with its own status and colour
// (employmentDetails, educationDetails, identityDetails, ...).
function getAdammaComponents(caseData) {
    return Object.entries(caseData || {})
        .filter(([key, value]) => /Details$/.test(key) && Array.isArray(value))
        .flatMap(([, value]) => value)
        .filter(item => item && typeof item === "object");
}

// Remarks once Adamma has graded the components: "Employment: Red; Education: Green;
// Identity: Green" with Red first, then Amber, then Green.
function getAdammaGradedRemarks(caseData) {
    const order = { RED: 0, AMBER: 1, ORANGE: 1, YELLOW: 1, GREEN: 2 };
    return getAdammaComponents(caseData)
        .filter(item => String(item.gradingColor || "").trim())
        .sort((a, b) =>
            (order[String(a.gradingColor).toUpperCase()] ?? 3) - (order[String(b.gradingColor).toUpperCase()] ?? 3))
        .map(item => `${item.component || "Check"}: ${String(item.gradingColor).trim()}`);
}

function getAdammaColor(data) {
    const details = Array.isArray(data?.checkDetails) ? data.checkDetails : [];
    return deriveOverallColor([data?.gradingColor, ...details.map(check => check?.gradingColor)]);
}

function parseAdammaCaseIdFromRemarks(remarks) {
    const match = String(remarks || "").match(/Adamma case ([^\s:]+)/i);
    return match ? match[1] : "";
}

// Writes the Adamma case status (and case ID) to the employee's cust_BGV record.
function toSuccessFactorsDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : `/Date(${date.getTime()})/`;
}

// One colour for the whole case from the vendor's colours (per check):
// any Red -> Red, else any Amber -> Amber, all Green -> Green.
function deriveOverallColor(colors) {
    const list = colors
        .map(color => String(color || "").trim().toUpperCase())
        .filter(Boolean);
    if (list.length === 0) return "";
    if (list.includes("RED")) return "Red";
    if (list.includes("AMBER") || list.includes("YELLOW") || list.includes("ORANGE")) return "Amber";
    if (list.every(color => color === "GREEN")) return "Green";
    return "";
}

function getSfColorCode(color) {
    const key = String(color || "").trim().toUpperCase();
    if (!key) return "";
    const entry = Object.entries(config.vendor.sfColorMap || {})
        .find(([name]) => name.trim().toUpperCase() === key);
    return entry ? String(entry[1]) : "";
}

// cust_Vendor code for a vendor: SF_VENDOR_MAP in .env first, else the value
// in the vendor picklist (V3) whose label or code matches the vendor's name.
async function getSfVendorCode(vendor) {
    const key = String(vendor || "").trim().toLowerCase();
    if (!key) return "";
    const entry = Object.entries(config.vendor.sfVendorMap || {})
        .find(([name]) => name.trim().toLowerCase() === key);
    if (entry) return String(entry[1]);
    return findPicklistCode(config.vendor.sfVendorPicklistId, getVendorLabel(vendor));
}

// Writes the vendor case to the employee's cust_BGV record:
// cust_Status (from the overall status), cust_Vendor (the vendor picked on
// screen, only when a case is created), and the optional case ID / date fields.
// Remarks text for SF: the vendor's own remarks without repeats, joined, cut to
// the field length; otherwise "<Vendor>: <status>".
function buildSfRemarks(vendor, remarks, status) {
    const unique = [...new Set(
        (Array.isArray(remarks) ? remarks : [remarks])
            .map(text => String(text || "").trim())
            .filter(Boolean)
    )];
    const text = unique.length > 0
        ? unique.join("; ")
        : [getVendorLabel(vendor), status].filter(Boolean).join(": ");
    const max = config.vendor.sfRemarksMaxLength || 38;
    return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;
}

async function writeVendorCaseToSuccessFactors(employeeId, { vendor, caseId, status, color, remarks, initiationDate, completionDate, setVendor }) {
    if (!config.vendor.sfWriteBack) {
        return { skipped: true, fields: {}, warnings: [] };
    }
    const record = await findBgvRecordByEmployeeId(employeeId);
    if (!record) {
        throw new Error(`No cust_BGV record found for employee ID ${employeeId}`);
    }

    const fields = {};
    const warnings = [];
    const statusCode = await resolveBgvStatusCode(record, status);
    if (statusCode && config.vendor.sfStatusField) {
        fields[config.vendor.sfStatusField] = statusCode;
    } else if (status) {
        warnings.push(
            `no ${config.vendor.sfStatusField} picklist value matches vendor status "${status}" ` +
            "(set ADAMMA_SF_STATUS_MAP in .env)"
        );
    }
    const colorField = config.vendor.sfColorField;
    const colorCode = getSfColorCode(color);
    if (colorCode && colorField) {
        fields[colorField] = colorCode;
    } else if (color && colorField) {
        warnings.push(`no ${colorField} value for colour "${color}" (set SF_COLOR_MAP in .env)`);
    } else if (setVendor && colorField && record[colorField]) {
        // A new case has no colour yet: clear the colour left from an earlier case.
        fields[colorField] = null;
    }
    const vendorField = config.vendor.sfVendorField;
    const vendorCode = setVendor && vendorField ? await getSfVendorCode(vendor) : "";
    if (vendorCode) {
        fields[vendorField] = vendorCode;
    } else if (setVendor && vendorField) {
        warnings.push(
            `${vendorField} not changed: "${getVendorLabel(vendor)}" is not a value of the SF vendor picklist ` +
            `${config.vendor.sfVendorPicklistId || ""} (add it in SF, or set SF_VENDOR_MAP in .env)`
        );
    }
    // The case ID is kept in the portal's own case store (caseStore.js).
    // It is written to SF only when a writable SF field is named in .env
    // (SF_CASE_ID_FIELD). SF's "BGV Profile Number" is read-only for the API.
    const caseIdField = config.vendor.sfCaseIdField;
    if (caseIdField && caseId && String(record[caseIdField] || "") !== String(caseId)) {
        fields[caseIdField] = String(caseId);
    }
    // Completion Date once the vendor has completed the case
    const completionField = config.vendor.sfCompletionDateField;
    if (completionField && completionField in record &&
        String(status || "").toUpperCase() === "COMPLETED" && !record[completionField]) {
        const date = toSuccessFactorsDate(completionDate) || toSuccessFactorsDate(new Date());
        fields[completionField] = date;
    }
    if (config.vendor.sfInitiationDateField && toSuccessFactorsDate(initiationDate)) {
        fields[config.vendor.sfInitiationDateField] = toSuccessFactorsDate(initiationDate);
    }
    if (config.vendor.sfRemarksField) {
        const remarksText = buildSfRemarks(vendor, remarks, status);
        if (remarksText) {
            fields[config.vendor.sfRemarksField] = remarksText;
        }
    }

    if (Object.keys(fields).length === 0) {
        return { skipped: false, fields, warnings };
    }
    try {
        await updateBgvRecord(employeeId, fields);
    } catch (error) {
        // A value SF does not accept rejects the whole update (SF does not always
        // name the field). Save the status anyway without the optional fields
        // (vendor, cleared colour) and warn about them.
        let optional = [vendorField, colorField, caseIdField, completionField].filter(field => field && field in fields &&
            (field !== colorField || fields[field] === null));
        if (optional.length === 0) {
            throw error;
        }
        // SF often names the field it rejects ("Property cust_X is not upsertable"):
        // then drop only that one and keep the others (e.g. Completion Date).
        const named = optional.filter(field => String(error.message || "").includes(field));
        if (named.length > 0) {
            optional = named;
        }
        for (const field of optional) {
            warnings.push(
                field === vendorField
                    ? `${vendorField} "${vendorCode}" was rejected (${error.message}); set SF_VENDOR_MAP in .env`
                    : field === colorField
                        ? `old ${field} could not be cleared (${error.message})`
                        : `${field} was not saved (${error.message})`
            );
            delete fields[field];
        }
        if (Object.keys(fields).length > 0) {
            await updateBgvRecord(employeeId, fields);
        }
    }
    return { skipped: false, fields, warnings };
}

async function getAdammaCaseStatus(caseId) {
    if (!caseId) {
        const error = new Error("Adamma case ID is required");
        error.status = 400;
        throw error;
    }
    const token = await getAdammaToken();
    try {
        const response = await axios.get(config.vendor.caseStatusUrl, {
            params: { caseid: caseId },
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json"
            },
            timeout: ADAMMA_REQUEST_TIMEOUT_MS
        });
        return response.data;
    } catch (error) {
        if (error.response) {
            const responseMessage = getVendorResponseMessage(error.response.data) ||
                error.response.statusText;
            const failure = new Error(
                `Adamma GetCaseStatus failed (HTTP ${error.response.status})${responseMessage ? `: ${responseMessage}` : ""}`,
                { cause: error }
            );
            failure.status = error.response.status === 404 ? 404 : 502;
            throw failure;
        }
        throw error;
    }
}

async function getAdammaCaseData(caseId) {
    if (!caseId) {
        const error = new Error("Adamma case ID is required");
        error.status = 400;
        throw error;
    }
    const token = await getAdammaToken();
    try {
        const response = await axios.get(config.vendor.caseDataUrl, {
            params: { caseid: caseId },
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json"
            },
            timeout: ADAMMA_REQUEST_TIMEOUT_MS
        });
        return response.data;
    } catch (error) {
        if (error.response) {
            const responseMessage = getVendorResponseMessage(error.response.data) ||
                error.response.statusText;
            const failure = new Error(
                `Adamma GetCaseData failed (HTTP ${error.response.status})${responseMessage ? `: ${responseMessage}` : ""}`,
                { cause: error }
            );
            failure.status = error.response.status === 404 ? 404 : 502;
            throw failure;
        }
        throw error;
    }
}

// Adamma case for the screen and for SF, from two Adamma APIs:
//   GetCaseData   -> status and gradingColor of the whole case
//   GetCaseStatus -> per check: status, gradingColor, description (used for remarks)
// Either one may fail; the other is still used.
async function getAdammaCaseSummary(caseId) {
    const [caseDataResult, caseStatusResult] = await Promise.allSettled([
        getAdammaCaseData(caseId),
        getAdammaCaseStatus(caseId)
    ]);
    if (caseDataResult.status === "rejected" && caseStatusResult.status === "rejected") {
        throw caseDataResult.reason;
    }
    const caseData = caseDataResult.status === "fulfilled" ? caseDataResult.value || {} : {};
    const caseStatus = caseStatusResult.status === "fulfilled" ? caseStatusResult.value || {} : {};
    const checkDetails = Array.isArray(caseStatus.checkDetails) ? caseStatus.checkDetails : [];
    return {
        caseId: String(caseData.caseId || caseStatus.caseId || caseId),
        status: String(caseData.status || caseStatus.status || "").trim(),
        color: deriveOverallColor([caseData.gradingColor]) || getAdammaColor(caseStatus),
        // Graded components first; until then Adamma's descriptions ("Data Entry Completed")
        remarks: getAdammaGradedRemarks(caseData).length
            ? getAdammaGradedRemarks(caseData)
            : [caseData.gradingRemarks, ...getAdammaRemarks(caseStatus)],
        initiationDate: caseData.initiationDate || caseStatus.initiationDate || "",
        completionDate: caseData.caseCompletionDate || caseStatus.caseCompletionDate || "",
        checkDetails,
        checks: checkDetails.length
            ? checkDetails.map(check => normalizeCheck({
                name: check.componentName,
                status: check.displayStatus || check.status,
                color: check.gradingColor,
                remarks: check.gradingRemarks || check.description,
                updatedAt: check.modifiedOn
            }))
            : getAdammaComponents(caseData).map(item => normalizeCheck({
                name: item.component,
                status: item.status,
                color: item.gradingColor,
                remarks: item.gradingRemarks || item.description
            })),
        // Adamma's report API is not available yet (ADAMMA_REPORT_URL when it is)
        hasReport: Boolean(config.vendor.reportUrl) &&
            String(caseData.status || "").toUpperCase() === "COMPLETED",
        vendorResponse: { caseData, caseStatus }
    };
}

// Reads the latest status from Adamma and stores it on the SF record.
// If no caseId is passed, it is taken from the SF case ID field or remarks.
async function syncAdammaCaseStatus(employeeId, caseId) {
    if (!employeeId) {
        const error = new Error("Employee ID is required");
        error.status = 400;
        throw error;
    }
    let resolvedCaseId = (await resolveEmployeeCase("adamma", employeeId, caseId, "")).caseId;
    if (!resolvedCaseId) {
        const record = await findBgvRecordByEmployeeId(employeeId);
        resolvedCaseId =
            parseAdammaCaseIdFromRemarks(record?.[config.vendor.sfRemarksField || "cust_Remarks"]);
    }
    if (!resolvedCaseId) {
        const error = new Error(
            `No Adamma case ID stored in SuccessFactors for employee ${employeeId}`
        );
        error.status = 404;
        throw error;
    }

    const summary = await getAdammaCaseSummary(resolvedCaseId);
    const sfUpdate = await writeVendorCaseToSuccessFactors(employeeId, {
        vendor: "adamma",
        caseId: resolvedCaseId,
        status: summary.status,
        color: summary.color,
        remarks: summary.remarks,
        completionDate: summary.completionDate,
        // SF Vendor must match the vendor whose result is written
        setVendor: true
    });
    const lastSyncedAt = new Date().toISOString();
    const remembered = rememberVendorCase(employeeId, {
        vendor: "adamma",
        caseId: resolvedCaseId,
        initiationDate: summary.initiationDate || undefined,
        status: summary.status,
        vendorStatus: summary.status,
        color: summary.color || "",
        remarks: (summary.remarks || []).filter(Boolean),
        completionDate: summary.completionDate || undefined,
        checks: summary.checks || [],
        hasReport: Boolean(summary.hasReport),
        lastSyncedAt
    });
    return {
        success: true,
        vendor: "Adamma",
        caseId: resolvedCaseId,
        status: summary.status,
        vendorStatus: summary.status,
        color: summary.color,
        remarks: (summary.remarks || []).filter(Boolean),
        initiationDate: summary.initiationDate || remembered?.initiationDate || "",
        completionDate: summary.completionDate || remembered?.completionDate || "",
        checks: summary.checks || [],
        hasReport: Boolean(summary.hasReport),
        lastSyncedAt,
        checkDetails: summary.checkDetails,
        sfUpdate,
        vendorResponse: summary.vendorResponse
    };
}

// Vendor key ("cfirst") from a label ("cFirst") or key
function getVendorKey(vendor) {
    const text = String(vendor || "").trim().toLowerCase().replace(/\s+/g, "");
    return ["adamma", "parishram", "cfirst", "vibrant"].find(key => text.includes(key)) || text;
}

// Saves the case in the portal's case store (never fails the caller)
function rememberVendorCase(employeeId, fields) {
    try {
        return caseStore.saveCase(employeeId, {
            ...fields,
            vendor: getVendorKey(fields.vendor),
            vendorLabel: getVendorLabel(getVendorKey(fields.vendor))
        });
    } catch (error) {
        console.warn("Vendor case could not be remembered", { employeeId, message: error.message });
        return null;
    }
}

// Case ID (and Ref ID) for an employee: the one passed in, else the portal's
// case store, else the SF case ID field.
async function resolveEmployeeCase(vendor, employeeId, caseId, refId) {
    const stored = caseStore.getCase(employeeId);
    const storedMatches = stored && (!caseId || String(stored.caseId) === String(caseId)) &&
        (!vendor || !stored.vendor || stored.vendor === getVendorKey(vendor));
    let resolvedCaseId = caseId ? String(caseId) : (storedMatches ? String(stored.caseId) : "");
    if (!resolvedCaseId) {
        const record = await findBgvRecordByEmployeeId(employeeId);
        const field = getCaseIdField(record);
        resolvedCaseId = field && record?.[field] ? String(record[field]) : "";
    }
    return {
        caseId: resolvedCaseId,
        refId: refId || (storedMatches ? stored.refId || "" : ""),
        initiationDate: storedMatches ? stored.initiationDate || "" : ""
    };
}

// After a vendor has created a case: write the status (and case ID / date when
// configured) to the SF cust_BGV record and build the message for the screen.
// A failed SF update must not turn into a failed initiation, or the user would
// submit again and create a duplicate case.
async function finishVendorInitiation({
    vendorLabel,
    employeeId,
    caseId,
    status,
    initiationDate,
    vendorStatus,
    color,
    remarks,
    fallbackMessage,
    vendorResponse
}) {
    const messageParts = [
        caseId
            ? `${vendorLabel} case ${caseId} created (${vendorStatus || status}).`
            : (fallbackMessage || `BGC case submitted to ${vendorLabel}.`)
    ];
    let sfUpdate = null;
    try {
        sfUpdate = await writeVendorCaseToSuccessFactors(employeeId, {
            vendor: vendorLabel,
            caseId,
            status,
            color,
            // The vendor's remark, else e.g. "Adamma: INITIATED"
            remarks: remarks || buildSfRemarks(vendorLabel, [], vendorStatus || status),
            initiationDate,
            setVendor: true
        });
        if (!sfUpdate.skipped) {
            const written = Object.entries(sfUpdate.fields)
                .map(([field, value]) => `${field}=${value}`)
                .join(", ");
            messageParts.push(written ? `SuccessFactors updated: ${written}.` : "");
            for (const warning of sfUpdate.warnings) {
                messageParts.push(`SuccessFactors warning: ${warning}.`);
            }
        }
    } catch (error) {
        console.error(`${vendorLabel} case created but SuccessFactors update failed`, {
            employeeId,
            caseId,
            message: error.message
        });
        sfUpdate = { error: error.message };
        messageParts.push(
            `The case was created, but SuccessFactors could not be updated (${error.message}). ` +
            "Do not resubmit; record the case ID manually."
        );
    }

    // Remember the case, so the portal can show it and refresh it later
    if (caseId) {
        rememberVendorCase(employeeId, {
            vendor: vendorLabel,
            caseId,
            initiationDate,
            status,
            vendorStatus: vendorStatus || status,
            color: color || "",
            remarks: Array.isArray(remarks) ? remarks : remarks ? [remarks] : []
        });
    }

    return {
        success: true,
        message: messageParts.filter(Boolean).join(" "),
        vendor: vendorLabel,
        caseId,
        status,
        vendorStatus: vendorStatus || status,
        color: color || "",
        initiationDate: initiationDate || "",
        sfUpdate,
        vendorResponse
    };
}

// Parishram has no overall case status; CheckStatus returns one status per
// check. Overall: all pending -> INITIATED, all completed -> COMPLETED,
// any failed -> FAILED, anything else -> IN PROGRESS.
function deriveParishramOverallStatus(checks) {
    const statuses = checks
        .map(check => String(check?.checkStatus || "").trim().toLowerCase())
        .filter(Boolean);
    if (statuses.length === 0) return "";
    const done = ["completed", "complete", "clear", "cleared", "closed", "verified"];
    const failed = ["failed", "fail", "rejected", "discrepancy", "red"];
    if (statuses.some(status => failed.includes(status))) return "FAILED";
    if (statuses.every(status => done.includes(status))) return "COMPLETED";
    if (statuses.every(status => status === "pending")) return "INITIATED";
    return "IN PROGRESS";
}

// Parishram's own wording for the footer: "Pending" when every check has the
// same status, otherwise "Completed (1), Pending (2)".
function summarizeParishramCheckStatuses(checks) {
    const counts = new Map();
    for (const check of checks) {
        const status = String(check?.checkStatus || "").trim();
        if (status) counts.set(status, (counts.get(status) || 0) + 1);
    }
    if (counts.size === 0) return "";
    if (counts.size === 1) return [...counts.keys()][0];
    return [...counts.entries()].map(([status, count]) => `${status} (${count})`).join(", ");
}

async function getParishramCaseStatus(caseId) {
    if (!caseId) {
        const error = new Error("Parishram case ID is required");
        error.status = 400;
        throw error;
    }
    const token = await getParishramToken();
    let data;
    try {
        const response = await axios.post(
            config.parishram.checkStatusUrl,
            { clientReferenceNumber: caseId },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/json",
                    "Content-Type": "application/json"
                },
                timeout: PARISHRAM_REQUEST_TIMEOUT_MS
            }
        );
        data = response.data;
    } catch (error) {
        if (error.response) {
            const responseMessage = getVendorResponseMessage(error.response.data) ||
                error.response.statusText;
            const failure = new Error(
                `Parishram CheckStatus failed (HTTP ${error.response.status})${responseMessage ? `: ${responseMessage}` : ""}`,
                { cause: error }
            );
            failure.status = 502;
            throw failure;
        }
        throw error;
    }
    if (data?.status === false) {
        const error = new Error(
            `Parishram CheckStatus failed${data?.message ? `: ${data.message}` : ""}`
        );
        error.status = 502;
        throw error;
    }
    const checks = Array.isArray(data?.data) ? data.data : [];
    return {
        caseId,
        status: deriveParishramOverallStatus(checks),
        vendorStatus: summarizeParishramCheckStatuses(checks),
        color: deriveOverallColor(checks.map(check => check?.checkColor)),
        remarks: checks.map(check => check?.remarks),
        checkDetails: checks.map(check => ({
            checkName: check.checkName || "",
            checkStatus: check.checkStatus || "",
            checkColor: check.checkColor || "",
            remarks: check.remarks || ""
        })),
        checks: checks.map(check => normalizeCheck({
            name: check.checkName,
            status: check.checkStatus,
            color: check.checkColor,
            remarks: check.remarks
        })),
        // Parishram's ReportFetch has the report once the case is completed
        hasReport: deriveParishramOverallStatus(checks) === "COMPLETED",
        vendorResponse: data
    };
}

// Final report PDF of a Parishram case (ReportFetch)
async function getParishramReport(caseId) {
    const token = await getParishramToken();
    let data;
    try {
        const response = await axios.post(
            config.parishram.reportFetchUrl,
            { clientReferenceNumber: caseId },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/json",
                    "Content-Type": "application/json"
                },
                timeout: 60000
            }
        );
        data = response.data;
    } catch (error) {
        if (error.response) {
            const responseMessage = getVendorResponseMessage(error.response.data) || error.response.statusText;
            const failure = new Error(
                `Parishram ReportFetch failed (HTTP ${error.response.status})${responseMessage ? `: ${responseMessage}` : ""}`,
                { cause: error }
            );
            failure.status = 502;
            throw failure;
        }
        throw error;
    }
    const base64 = String(data?.report || data?.data?.report || "").replace(/\s/g, "");
    if (data?.status === false || !base64) {
        const error = new Error(`Parishram report is not available yet${data?.message ? `: ${data.message}` : ""}`);
        error.status = 404;
        throw error;
    }
    const type = String(data.reportType || "PDF").toLowerCase();
    return {
        fileName: `BGV_Report_${caseId}.${type}`,
        contentType: type === "pdf" ? "application/pdf" : "application/octet-stream",
        base64
    };
}

// cFirst ids from the AddCandidate response: CandidateId, plus the cFirst
// reference id that GetCandidateDetailedReport also needs.
function getCFirstCaseIds(responseData) {
    const result = responseData?.AddCandidateResult || responseData || {};
    const pick = (...keys) => {
        for (const key of keys) {
            const value = result?.[key] ?? responseData?.[key];
            if (value !== undefined && value !== null && String(value).trim() !== "") {
                return String(value).trim();
            }
        }
        return "";
    };
    const profileNumber = pick("ProfileNumber", "profileNumber", "ProfileNo");
    return {
        candidateId: pick("CandidateId", "CandidateID", "candidateId"),
        refId: toCFirstRefNumber(
            pick("cFirstRefId", "CFirstRefId", "cfirstRefId", "RefId", "RefNo") || profileNumber
        ),
        profileNumber
    };
}

// cFirst Ref ID is a number. cFirst also shows it inside the profile number,
// e.g. "CF-8534240-PROF" -> "8534240". Returns "" when there is no number.
function toCFirstRefNumber(value) {
    const text = String(value ?? "").trim();
    if (/^\d+$/.test(text)) return text;
    const match = text.match(/\d{4,}/);
    return match ? match[0] : "";
}

// cFirst status values (confirmed by cFirst):
//   CaseStatus (per check):   IN-PROGRESS, INSUFFICIENCY, STOP_CHECK, GREEN, ORANGE, RED
//   Profile.Status (overall): In Progress, STOP_CHECK, GREEN, ORANGE, RED
// There is no separate colour field: the status itself becomes the colour
// when the check / profile is completed. ORANGE is SF "Amber".
// The profile colour is cFirst's overall result (RED first, then ORANGE, then GREEN).
function interpretCFirstStatus(statusText) {
    const upper = String(statusText || "").trim().toUpperCase().replace(/[\s_-]+/g, " ");
    if (upper === "GREEN") return { status: "COMPLETED", color: "Green" };
    if (upper === "ORANGE" || upper === "AMBER") return { status: "COMPLETED", color: "Amber" };
    if (upper === "RED") return { status: "COMPLETED", color: "Red" };
    if (upper.includes("STOP")) return { status: "FAILED", color: "" };
    if (upper.includes("INSUFF")) return { status: "IN PROGRESS", color: "" };
    if (upper.includes("PROGRESS") || upper.includes("PENDING")) return { status: "IN PROGRESS", color: "" };
    return { status: upper || "", color: "" };
}

// cFirst remarks come as "Employer Name : \rDocument Required : OFFER LETTER.".
// SF Remarks holds only 38 characters, so keep just the values:
// "OFFER LETTER" (labels with no value are dropped).
function cleanCFirstRemark(value) {
    return String(value || "")
        .split(/[\r\n]+/)
        .map(part => {
            const text = part.replace(/\s+/g, " ").trim();
            const colon = text.indexOf(":");
            return (colon >= 0 ? text.slice(colon + 1) : text).replace(/[.;\s]+$/, "").trim();
        })
        .filter(Boolean)
        .join(", ");
}

// Full cFirst remark for the screen: "Document Required: OFFER LETTER"
// (labels kept, empty labels such as "Employer Name :" dropped).
function describeCFirstRemark(value) {
    return String(value || "")
        .split(/[\r\n]+/)
        .map(part => part.replace(/\s+/g, " ").replace(/\s*:\s*/g, ": ").trim().replace(/[.;\s]+$/, ""))
        .filter(part => part && !/^[^:]+:\s*$/.test(part))
        .join("; ");
}

// SF Remarks for cFirst: insufficiencies first (with cFirst's remark), then the
// other checks, e.g. "EMPLOYMENT: Insufficiency - Relieving letter missing".
function buildCFirstRemarks(checks) {
    const describe = check => {
        const upper = String(check.CaseStatus || "").toUpperCase();
        const status = upper.includes("INSUFF") ? "Insuff"
            : upper.includes("STOP") ? "Stopped"
            : String(check.CaseStatus || "").trim();
        const remark = cleanCFirstRemark(check.Remarks);
        return [
            [check.CaseType, status].filter(Boolean).join(": "),
            remark
        ].filter(Boolean).join(" - ");
    };
    const isInsuff = check => String(check.CaseStatus || "").toUpperCase().includes("INSUFF");
    return [
        ...checks.filter(isInsuff).map(describe),
        ...checks.filter(check => !isInsuff(check)).map(describe)
    ].filter(Boolean);
}

// cFirst dates look like "05-Nov-2026" -> ISO date string, "" when empty.
function parseCFirstDate(value) {
    const match = String(value || "").trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (!match) return "";
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
        .indexOf(match[2].toLowerCase());
    if (month < 0) return "";
    return new Date(Date.UTC(Number(match[3]), month, Number(match[1]))).toISOString();
}

function describeCFirstProfileStatus(profileStatus, checks) {
    const text = String(profileStatus || "").trim();
    const insuffCount = checks.filter(check =>
        String(check.CaseStatus || "").toUpperCase().includes("INSUFF")
    ).length;
    if (insuffCount > 0 && interpretCFirstStatus(text).status === "IN PROGRESS") {
        return `${text || "In Progress"} (${insuffCount} Insufficiency)`;
    }
    return text;
}

async function getCFirstCaseStatus(candidateId, refId, { includeReport = false } = {}) {
    if (!candidateId) {
        const error = new Error("cFirst CandidateId is required");
        error.status = 400;
        throw error;
    }
    const accessToken = await getCFirstAccessToken();
    let data;
    try {
        const response = await axios.get(config.cFirst.detailedReportUrl, {
            params: {
                accesstoken: accessToken,
                CandidateId: candidateId,
                ...(refId ? { cFirstRefId: refId } : {})
            },
            headers: { Accept: "application/json" },
            timeout: 60000
        });
        data = response.data;
    } catch (error) {
        if (error.response) {
            const responseMessage = getVendorResponseMessage(error.response.data) ||
                error.response.statusText;
            const failure = new Error(
                `cFirst GetCandidateDetailedReport failed (HTTP ${error.response.status})${responseMessage ? `: ${responseMessage}` : ""}`,
                { cause: error }
            );
            failure.status = 502;
            throw failure;
        }
        throw error;
    }

    const result = data?.GetCandidateDetailedReportResult || data || {};
    const errors = result.BGVErrors;
    const hasErrors = errors && (!Array.isArray(errors) || errors.length > 0);
    // cFirst can return an error (e.g. "Could not find file ...TestcFirst.pdf",
    // a missing report file on their server) together with a valid Profile.
    // Use the Profile status anyway and pass the error on as a warning.
    // A Profile without a Status (e.g. on "401 Unauthorized", where cFirst
    // returns only the CandidateId) is not a usable answer: report the error.
    if (hasErrors && !String(result.Profile?.Status || "").trim()) {
        const error = new Error(`cFirst GetCandidateDetailedReport: ${summarizeCFirstBgvErrors(errors)}`);
        error.status = 502;
        throw error;
    }
    const vendorWarning = hasErrors ? `cFirst reported: ${summarizeCFirstBgvErrors(errors)}` : "";
    const profile = result.Profile || {};
    const checks = Array.isArray(result.Checks) ? result.Checks : [];
    const overall = interpretCFirstStatus(profile.Status);
    const profileNumber = String(profile.ProfileNumber || profile.ProfileNo || "").trim();
    return {
        caseId: String(profile.CandidateId || candidateId),
        // cFirst Ref ID: the one we sent, else the one in the profile
        refId: toCFirstRefNumber(refId) ||
            toCFirstRefNumber(profile.cFirstRefId || profile.CFirstRefId || profile.RefId) ||
            toCFirstRefNumber(profileNumber),
        profileNumber,
        initiationDate: parseCFirstDate(profile.BGVInitiationDate),
        completionDate: parseCFirstDate(profile.BGVCompletionDate),
        status: overall.status,
        // Footer text, e.g. "In Progress (1 Insufficiency)"
        vendorStatus: describeCFirstProfileStatus(profile.Status, checks),
        color: overall.color,
        remarks: buildCFirstRemarks(checks),
        checkDetails: checks,
        checks: checks.map(check => normalizeCheck({
            name: check.CaseType,
            status: check.CaseStatus,
            remarks: describeCFirstRemark(check.Remarks),
            raisedAt: parseCFirstDate(check.InsuffRaisedDate)
        })),
        hasReport: Array.isArray(result.Reports) && result.Reports.some(report => report?.AttachmentBody),
        ...(includeReport ? { reportFile: pickCFirstReport(result.Reports, candidateId) } : {}),
        vendorWarning,
        vendorResponse: { ...result, Reports: undefined }
    };
}

// The candidate's final report PDF from cFirst's Reports[] (one per candidate)
function pickCFirstReport(reports, candidateId) {
    const report = (Array.isArray(reports) ? reports : []).find(item => item?.AttachmentBody);
    if (!report) return null;
    const type = String(report.AttachmentType || "pdf").replace(/^\./, "").toLowerCase();
    return {
        fileName: report.AttachmentName || `BGV_Report_${candidateId}.${type}`,
        contentType: type === "pdf" ? "application/pdf" : "application/octet-stream",
        base64: String(report.AttachmentBody).replace(/\s/g, "")
    };
}

// ---------------------------------------------------------------------------
// One check of a case in the same shape for every vendor, for the screen:
// { name, status, color, remarks, updatedAt, raisedAt }
// status: Completed | In Progress | Pending | Insufficiency | Stopped | Failed
// color:  Green | Amber | Red, only once the check is completed
// ---------------------------------------------------------------------------
function titleCase(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, letter => letter.toUpperCase());
}

function normalizeColor(value) {
    const upper = String(value || "").trim().toUpperCase();
    if (upper === "GREEN") return "Green";
    if (upper === "RED") return "Red";
    if (["AMBER", "ORANGE", "YELLOW"].includes(upper)) return "Amber";
    return "";
}

function normalizeCheckStatus(rawStatus) {
    const upper = String(rawStatus || "").trim().toUpperCase();
    if (!upper) return "Pending";
    if (upper.includes("INSUFF")) return "Insufficiency";
    if (upper.includes("STOP")) return "Stopped";
    if (upper.includes("FAIL") || upper.includes("REJECT")) return "Failed";
    if (normalizeColor(upper)) return "Completed";
    if (/COMPLET|CLEAR|ACCEPT|CLOSED|VERIFIED|DONE/.test(upper)) return "Completed";
    if (upper.includes("PENDING") || upper.includes("INITIAT")) return "Pending";
    if (/PROGRESS|WIP|INCEPT|QC/.test(upper)) return "In Progress";
    return titleCase(upper);
}

function normalizeCheck({ name, status, color, remarks, updatedAt, raisedAt }) {
    const normalizedStatus = normalizeCheckStatus(status);
    return {
        name: titleCase(name) || "Check",
        status: normalizedStatus,
        // e.g. cFirst "GREEN" is both the status and the result colour
        color: normalizedStatus === "Completed" ? (normalizeColor(color) || normalizeColor(status)) : "",
        remarks: String(remarks || "").trim(),
        updatedAt: updatedAt || "",
        raisedAt: raisedAt || ""
    };
}

function getVendorLabel(vendor) {
    const key = String(vendor || "").toLowerCase();
    return { adamma: "Adamma", parishram: "Parishram", cfirst: "cFirst", vibrant: "Vibrant" }[key] ||
        String(vendor || "");
}

// Final report file of a case: { fileName, contentType, buffer }
async function getVendorReport(vendor, caseId, refId) {
    const key = getVendorKey(vendor);
    if (!caseId) {
        const error = new Error("Case ID is required");
        error.status = 400;
        throw error;
    }
    let file = null;
    if (key === "cfirst") {
        const stored = caseStore.listCases().find(item => String(item.caseId) === String(caseId));
        const result = await getCFirstCaseStatus(caseId, refId || stored?.refId || "", { includeReport: true });
        file = result.reportFile;
        if (!file) {
            const error = new Error("cFirst has not uploaded the report yet");
            error.status = 404;
            throw error;
        }
    } else if (key === "parishram") {
        file = await getParishramReport(caseId);
    } else if (key === "adamma") {
        if (!config.vendor.reportUrl) {
            const error = new Error("Adamma's report API is not available yet");
            error.status = 501;
            throw error;
        }
        const token = await getAdammaToken();
        const response = await axios.get(config.vendor.reportUrl, {
            params: { caseid: caseId },
            headers: { Authorization: `Bearer ${token}` },
            responseType: "arraybuffer",
            timeout: 60000
        });
        return {
            fileName: `BGV_Report_${caseId}.pdf`,
            contentType: response.headers?.["content-type"] || "application/pdf",
            buffer: Buffer.from(response.data)
        };
    } else {
        const error = new Error(`Reports are not available for ${vendor}`);
        error.status = 501;
        throw error;
    }
    return {
        fileName: file.fileName,
        contentType: file.contentType,
        buffer: Buffer.from(file.base64, "base64")
    };
}

// Latest status of a case from the vendor (no SF update).
async function getVendorCaseStatus(vendor, caseId, refId) {
    const key = String(vendor || "").toLowerCase();
    if (key === "adamma") {
        return getAdammaCaseSummary(caseId);
    }
    if (key === "cfirst") {
        return getCFirstCaseStatus(caseId, refId);
    }
    if (key === "parishram") {
        return getParishramCaseStatus(caseId);
    }
    const error = new Error(`Case status is not available for ${vendor}`);
    error.status = 501;
    throw error;
}

// Latest vendor status written to the SF cust_BGV record.
async function syncVendorCaseStatus(vendor, employeeId, caseId, refId) {
    const key = String(vendor || "").toLowerCase();
    if (key === "adamma") {
        return syncAdammaCaseStatus(employeeId, caseId);
    }
    if (!employeeId) {
        const error = new Error("Employee ID is required");
        error.status = 400;
        throw error;
    }
    const resolved = await resolveEmployeeCase(vendor, employeeId, caseId, refId);
    const resolvedCaseId = resolved.caseId;
    if (!resolvedCaseId) {
        const error = new Error(`No ${getVendorLabel(vendor)} case ID for employee ${employeeId}`);
        error.status = 404;
        throw error;
    }
    const result = await getVendorCaseStatus(vendor, resolvedCaseId, resolved.refId);
    const sfUpdate = result.status
        ? await writeVendorCaseToSuccessFactors(employeeId, {
            vendor,
            caseId: resolvedCaseId,
            status: result.status,
            color: result.color,
            remarks: result.remarks,
            completionDate: result.completionDate,
            setVendor: true
        })
        : { skipped: true, fields: {}, warnings: [`${getVendorLabel(vendor)} returned no check statuses`] };
    const lastSyncedAt = new Date().toISOString();
    const remembered = rememberVendorCase(employeeId, {
        vendor,
        caseId: resolvedCaseId,
        refId: result.refId || resolved.refId || undefined,
        profileNumber: result.profileNumber || undefined,
        initiationDate: result.initiationDate || resolved.initiationDate || undefined,
        status: result.status,
        vendorStatus: result.vendorStatus || result.status,
        color: result.color || "",
        remarks: result.remarks || [],
        completionDate: result.completionDate || undefined,
        checks: result.checks || [],
        hasReport: Boolean(result.hasReport),
        lastSyncedAt
    });
    return {
        success: true,
        vendor: getVendorLabel(vendor),
        caseId: resolvedCaseId,
        refId: result.refId || resolved.refId || "",
        profileNumber: result.profileNumber || "",
        status: result.status,
        vendorStatus: result.vendorStatus || result.status,
        color: result.color || "",
        remarks: (result.remarks || []).filter(Boolean),
        vendorWarning: result.vendorWarning || "",
        initiationDate: result.initiationDate || remembered?.initiationDate || "",
        completionDate: result.completionDate || remembered?.completionDate || "",
        checks: result.checks || [],
        hasReport: Boolean(result.hasReport),
        lastSyncedAt,
        checkDetails: result.checkDetails,
        sfUpdate,
        vendorResponse: result.vendorResponse
    };
}

async function initiateAdammaBGC(payload) {
    const candidate = payload.candidateInfo || {};
    const selectedFiles = await getSelectedDocumentsForSubmission(payload);

    const formData = new FormData();
    const { clientName, subclientName } = resolveAdammaClientNames(candidate);
    const textFields = {
        clientName,
        subclientName,
        candidateName: parishramValue(candidate.name),
        empid: parishramValue(payload.preProfileNumber || candidate.employeeId || payload.employeeId),
        dateofbirth: formatAdammaDate(candidate.dob),
        fathername: parishramValue(candidate.fatherName),
        aadhernumber: parishramValue(candidate.aadhaarNumber),
        pancard: parishramValue(candidate.panNumber),
        emailid: parishramValue(candidate.email),
        number: parishramValue(candidate.phone),
        process: parishramValue(config.vendor.processName || "Test Process"),
        location: parishramValue(candidate.location) || parishramValue(candidate.client),
        // Adamma saves doj as a real date: "17/07/2026" (DD/MM) fails there with
        // "Cast to date failed", so it is sent as YYYY-MM-DD.
        doj: formatAdammaIsoDate(candidate.joiningDate),
        componentsToCheck: JSON.stringify(payload.selectedChecks.map(check => {
            const componentName = String(check.name || check.id || "")
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "");
            const component = { componentName };

            if (componentName === "criminalcourt") {
                component.dob = formatAdammaDate(candidate.dob);
                component.fathername = parishramValue(candidate.fatherName);
            } else if (componentName === "idbgdb") {
                component.name = parishramValue(candidate.name);
                component.dob = formatAdammaDate(candidate.dob);
                component.fathername = parishramValue(candidate.fatherName);
            } else if (componentName === "identity") {
                component.name = parishramValue(candidate.name);
                component.dob = formatAdammaDate(candidate.dob);
                component.fathername = parishramValue(candidate.fatherName);
                component.typeofid = "Aadhar Card";
                component.idnumber = parishramValue(candidate.aadhaarNumber);
            }

            return component;
        }))
    };

    for (const [key, value] of Object.entries(textFields)) {
        formData.append(key, String(value));
    }

    for (const document of selectedFiles) {
        const content = Buffer.from(document.fileContent.replace(/\s/g, ""), "base64");
        formData.append(
            "files",
            new Blob([content], { type: document.mimeType || "application/octet-stream" }),
            document.fileName || document.file
        );
    }

    let adammaResponse;
    try {
        const token = await getAdammaToken();
        const response = await axios.post(config.vendor.initiationUrl, formData, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json"
            },
            timeout: 60000,
            maxBodyLength: Infinity
        });
        adammaResponse = response.data;
    } catch (error) {
        if (error.response) {
            const responseMessage = getVendorResponseMessage(error.response.data) ||
                error.response.statusText;
            const clientHint = /client not found/i.test(responseMessage || "")
                ? ` Adamma has no client "${clientName}" / sub-client "${subclientName}". ` +
                  "Ask Adamma to register this cust_PrimaryProject / cust_SecondaryProject, or for UAT set " +
                  "ADAMMA_CLIENT_NAME and ADAMMA_SUBCLIENT_NAME (Test) in Backend/.env."
                : "";
            const failure = new Error(
                `Adamma case initiation failed (HTTP ${error.response.status})${responseMessage ? `: ${responseMessage}` : ""}.${clientHint}`,
                { cause: error }
            );
            failure.stage = "adamma-case-initiation";
            failure.vendorStatus = error.response.status;
            failure.vendorMessage = responseMessage || "";
            throw failure;
        }
        throw error;
    }

    // The case now exists in Adamma. Read its status and colour once
    // (GetCaseData / GetCaseStatus); if that fails the case still counts as created.
    const caseId = getAdammaCaseId(adammaResponse);
    let summary = null;
    if (caseId) {
        try {
            summary = await getAdammaCaseSummary(caseId);
        } catch (error) {
            console.warn("Adamma case status after initiation failed", { caseId, message: error.message });
        }
    }
    return finishVendorInitiation({
        vendorLabel: "Adamma",
        employeeId: payload.employeeId,
        caseId,
        status: String(adammaResponse?.status || "INITIATED"),
        vendorStatus: summary?.status,
        color: summary?.color,
        remarks: summary?.remarks,
        initiationDate: adammaResponse?.initiationDate || "",
        fallbackMessage: adammaResponse?.message,
        vendorResponse: adammaResponse
    });
}

async function initiateBGC(payload) {
    const vendor = String(payload.vendor).toLowerCase();
    if (vendor === "cfirst") {
        return initiateCFirstBGC(payload);
    }
    if (vendor === "parishram") {
        return submitParishramBGC(payload);
    }
    if (vendor === "vibrant") {
        return submitVibrantBGC(payload);
    }
    if (vendor !== "adamma") {
        const error = new Error(`Vendor initiation is not configured for ${payload.vendor}`);
        error.status = 501;
        throw error;
    }
    return initiateAdammaBGC(payload);
}
function getVendorResponseMessage(data) {
    if (typeof data === "string") return data.trim().slice(0, 2000);
    if (!data || typeof data !== "object") return "";

    const candidates = [
        data.message,
        data.error,
        data.detail,
        data.details,
        data.errors,
        data.error_description
    ];
    const message = candidates.find(value => value !== undefined && value !== null && value !== "");
    if (typeof message === "string" || typeof message === "number") {
        return String(message).slice(0, 2000);
    }
    if (message !== undefined) {
        try {
            return JSON.stringify(message).slice(0, 2000);
        } catch {
            return "";
        }
    }

    try {
        return JSON.stringify(data).slice(0, 2000);
    } catch {
        return "";
    }
}

// Adamma wants dates as DD/MM/YYYY (Adamma clarification document, point 7).
function formatAdammaDate(value) {
    const iso = formatAdammaIsoDate(value);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

function formatAdammaIsoDate(value) {
    if (!value || value === "-") return "";
    const successFactorsDate = String(value).match(/^\/Date\((-?\d+)/);
    const date = successFactorsDate
        ? new Date(Number(successFactorsDate[1]))
        : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toISOString().slice(0, 10);
}


module.exports = {
    initiateBGC,
    getVendorChecks,
    getVendorCatalog,
    getLastKnownAdammaChecks,
    getLastKnownParishramChecks,
    getAdammaToken,
    getParishramToken,
    getVibrantToken,
    getCFirstAccessToken,
    getAdammaCaseStatus,
    getAdammaCaseData,
    getAdammaCaseSummary,
    syncAdammaCaseStatus,
    getParishramCaseStatus,
    getCFirstCaseStatus,
    interpretCFirstStatus,
    getVendorCaseStatus,
    getVendorReport,
    syncVendorCaseStatus,
    deriveParishramOverallStatus,
    deriveOverallColor,
    resolveAdammaClientNames,
    getCheckListItems,
    findAuthToken
};