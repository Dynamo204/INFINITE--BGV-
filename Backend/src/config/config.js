const path = require("path");

require("dotenv").config({
    path: path.resolve(__dirname, "../../.env")
});

function parseJsonObject(name) {
    const raw = String(process.env[name] || "").trim();
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
        console.warn(`${name} is not valid JSON; ignoring it`);
        return {};
    }
}

module.exports = {
    port: process.env.PORT || 3000,
    frontendOrigins: (process.env.FRONTEND_ORIGINS || "")
        .split(",")
        .map(origin => origin.trim())
        .filter(Boolean),

    successFactors: {
        baseUrl: process.env.SF_BASE_URL,
        username: process.env.SF_USERNAME,
        password: process.env.SF_PASSWORD,
        // cust_BGV is effective-dated. "Today" is taken in this time zone so the
        // app reads and updates the same record version the SF screen shows.
        timeZone: process.env.SF_TIMEZONE || "Asia/Kolkata"
    },

    vendor: {
        apiUrl: process.env.VENDOR_API_URL,
        initiationUrl: process.env.ADAMMA_INITIATION_URL ||
            process.env.ADAMMA_API_URL ||
            "https://uat-explorer.adamma.in/api/apiroutes/case_initiation_checks",
        checklistUrl: process.env.VENDOR_CHECKLIST_URL ||
            process.env.ADAMMA_CHECKLIST_URL ||
            "https://uat-explorer.adamma.in/api/clientcontractcomponents/alacarte/TEST",
        // GetCaseData: one status + gradingColor for the whole case
        caseDataUrl: process.env.ADAMMA_CASE_DATA_URL ||
            "https://uat-explorer.adamma.in/api/apigetcaseroutes/GetCaseData",
        // GetCaseStatus: status, colour and description per check
        caseStatusUrl: process.env.ADAMMA_CASE_STATUS_URL ||
            "https://uat-explorer.adamma.in/api/apigetcaseroutes/GetCaseStatus",
        // Final report API of Adamma (not available yet; set when Adamma shares it)
        reportUrl: process.env.ADAMMA_REPORT_URL || "",
        authUrl: process.env.ADAMMA_AUTH_URL ||
            "https://uat-explorer.adamma.in/api/generateAuthCode",
        userId: process.env.ADAMMA_USER_ID,
        password: process.env.ADAMMA_PASSWORD,
        processName: process.env.ADAMMA_PROCESS_NAME || "Test Process",

        // Adamma only accepts client / sub-client names that are registered in
        // Adamma for your account. Anything else returns 404 "Client not found".
        // Fixed names (e.g. "Test" in UAT) win over the employee's SF values.
        clientName: process.env.ADAMMA_CLIENT_NAME || "",
        subclientName: process.env.ADAMMA_SUBCLIENT_NAME || "",
        // Optional per-client mapping: SF client label -> Adamma client name,
        // e.g. '{"Oracle IMS":"ORACLE"}'. Used before ADAMMA_CLIENT_NAME.
        clientMap: parseJsonObject("ADAMMA_CLIENT_MAP"),
        subclientMap: parseJsonObject("ADAMMA_SUBCLIENT_MAP"),

        // Write-back of the Adamma case to the SF cust_BGV record
        sfWriteBack: String(process.env.ADAMMA_SF_WRITEBACK || "true").toLowerCase() !== "false",
        sfStatusField: process.env.ADAMMA_SF_STATUS_FIELD || "cust_Status",
        sfStatusNavigation: process.env.ADAMMA_SF_STATUS_NAV || "cust_StatusNav",
        sfStatusPicklistId: process.env.ADAMMA_SF_STATUS_PICKLIST_ID || "",
        // Adamma status -> cust_Status code of the SF picklist "st"
        // (01 Completed, 02 Initiated, 03 Progress, 04 Failed). ADAMMA_SF_STATUS_MAP in .env
        // adds to or overrides these, e.g. '{"WIP":"03"}'.
        sfStatusMap: {
            INITIATED: "02",
            PENDING: "02",
            "IN PROGRESS": "03",
            INPROGRESS: "03",
            PROGRESS: "03",
            COMPLETED: "01",
            FAILED: "04",
            ...parseJsonObject("ADAMMA_SF_STATUS_MAP")
        },
        // SF Remarks gets the vendor's own remark (e.g. Parishram "Case Initiated",
        // Adamma "Data Entry Completed"). The field holds at most 38 characters.
        // Set SF_REMARKS_FIELD= (empty) in .env to stop writing it.
        sfRemarksField: process.env.SF_REMARKS_FIELD ?? "cust_Remarks",
        sfRemarksMaxLength: Number.parseInt(process.env.SF_REMARKS_MAX_LENGTH || "", 10) || 38,
        // SF field that keeps the vendor case ID ("BGV Profile Number"), for all
        // vendors. Empty = found automatically on cust_BGV (a field named like
        // ...ProfileNumber or ...CaseID). Set SF_CASE_ID_FIELD to name it exactly.
        sfCaseIdField: process.env.SF_CASE_ID_FIELD || process.env.ADAMMA_SF_CASE_ID_FIELD || "",
        // SF "Completion Date": set when the vendor completes the case.
        // Set SF_COMPLETION_DATE_FIELD= (empty) to stop writing it.
        sfCompletionDateField: process.env.SF_COMPLETION_DATE_FIELD ?? "cust_CompletionDate",
        // SF field that records which vendor the case went to, and the
        // picklist code for each vendor (as shown in SF, e.g. "Adamma (Adamma)").
        // SF_VENDOR_MAP in .env overrides a code, e.g. '{"parishram":"PARISHRAM"}'.
        sfVendorField: process.env.SF_VENDOR_FIELD ?? "cust_Vendor",
        // Picklist behind cust_Vendor (SF error messages call it "V3"). The code
        // is looked up there by the vendor's name; SF_VENDOR_MAP overrides it.
        sfVendorPicklistId: process.env.SF_VENDOR_PICKLIST_ID ?? "V3",
        sfVendorMap: parseJsonObject("SF_VENDOR_MAP"),
        // SF "Overall Status" field and its picklist codes (1 Green, 2 Red, 3 Amber).
        // The vendor's colour is saved here. SF_COLOR_MAP overrides a code.
        sfColorField: process.env.SF_COLOR_FIELD ?? "cust_overallverification",
        sfColorMap: {
            GREEN: "1",
            RED: "2",
            AMBER: "3",
            ...parseJsonObject("SF_COLOR_MAP")
        },
        // Optional dedicated SF date field for the Adamma initiation date
        sfInitiationDateField: process.env.ADAMMA_SF_INITIATION_DATE_FIELD || ""
    },

    // Where the portal remembers each employee's vendor case (case ID, Ref ID,
    // last status). Default Backend/data/vendor-cases.json.
    caseStore: {
        path: process.env.VENDOR_CASE_STORE_PATH ||
            path.resolve(__dirname, "../../data/vendor-cases.json")
    },

    // Background job: every N minutes, gets the latest status of every open case
    // (Initiated / Progress with a case ID) from its vendor and updates SF.
    // OFF by default: statuses are updated manually with Refresh.
    // Set AUTO_SYNC_INTERVAL_MINUTES=60 (for example) to turn it on later.
    autoSync: {
        intervalMinutes: Number.parseInt(process.env.AUTO_SYNC_INTERVAL_MINUTES ?? "", 10) >= 0
            ? Number.parseInt(process.env.AUTO_SYNC_INTERVAL_MINUTES, 10)
            : 0,
        // SF status codes that count as open (02 Initiated, 03 Progress)
        openStatusCodes: String(process.env.AUTO_SYNC_STATUS_CODES || "02,03")
            .split(",").map(code => code.trim()).filter(Boolean)
    },

    // RAP app (S/4HANA) with the client-wise checklist (entity InfiniteClient)
    rap: {
        clientChecklistUrl: process.env.RAP_CLIENT_CHECKLIST_URL ||
            "https://my434938-api.s4hana.cloud.sap/sap/opu/odata4/sap/zsb_infinite_client/srvd_a2x/sap/zsd_infinite_client/0001/InfiniteClient",
        username: process.env.RAP_USERNAME,
        password: process.env.RAP_PASSWORD
    },

    cFirst: {
        authenticationUrl: process.env.CFIRST_AUTHENTICATION_URL ||
            process.env.CFIRST_ACCESS_TOKEN_URL ||
            "https://api.cfirstcorp.com/IBgvCandidate.svc/json/authentication",
        packageListUrl: process.env.CFIRST_PACKAGE_LIST_URL ||
            "https://api.cfirstcorp.com/IBgvCandidate.svc/json/GetPackageList",
        addCandidateUrl: process.env.CFIRST_ADD_CANDIDATE_URL ||
            "https://api.cfirstcorp.com/IBgvCandidate.svc/json/AddCandidate",
        // Status, colour and final report of a candidate (CandidateId + cFirstRefId)
        detailedReportUrl: process.env.CFIRST_DETAILED_REPORT_URL ||
            "https://api.cfirstcorp.com/IBgvCandidate.svc/json/GetCandidateDetailedReport",
        userName: process.env.CFIRST_USER_NAME,
        password: process.env.CFIRST_PASSWORD,
        apiKey: process.env.CFIRST_API_KEY,
        maxAttachmentBytes:
            // 0 = no limit (cFirst sets none). Set CFIRST_MAX_ATTACHMENT_BYTES to add one.
            Number.parseInt(process.env.CFIRST_MAX_ATTACHMENT_BYTES || "", 10) || 0,
        addCandidateTimeoutMs:
            Number.parseInt(process.env.CFIRST_ADD_CANDIDATE_TIMEOUT_MS || "", 10) || 180000,
        addCandidateRetryCount:
            Number.parseInt(process.env.CFIRST_ADD_CANDIDATE_RETRY_COUNT || "", 10) || 2,
        addCandidateRetryDelayMs:
            Number.parseInt(process.env.CFIRST_ADD_CANDIDATE_RETRY_DELAY_MS || "", 10) || 1500,
        debugErrors: String(process.env.CFIRST_DEBUG_ERRORS || "").toLowerCase() === "true"
    },

    parishram: {
        tokenUrl: process.env.PARISHRAM_TOKEN_URL ||
            "https://service.pess.co.in/BGV_API/GenerateToken.php",
        caseInitiateUrl: process.env.PARISHRAM_CASE_INITIATE_URL ||
            "https://service.pess.co.in/BGV_API/CaseInitiate.php",
        checkStatusUrl: process.env.PARISHRAM_CHECK_STATUS_URL ||
            "https://service.pess.co.in/BGV_API/CheckStatus.php",
        // Final report PDF (Base64) of a case
        reportFetchUrl: process.env.PARISHRAM_REPORT_FETCH_URL ||
            "https://service.pess.co.in/BGV_API/ReportFetch.php",
        userName: process.env.PARISHRAM_USER_NAME || process.env.PARISHRAM_USERNAME,
        password: process.env.PARISHRAM_PASSWORD,
        loginPayload: process.env.PARISHRAM_LOGIN_PAYLOAD || "",
        userId: process.env.PARISHRAM_USER_ID ||
            process.env.PARISHRAM_USER_NAME ||
            process.env.PARISHRAM_USERNAME
    },

    vibrant: {
        tokenUrl: process.env.VIBRANT_TOKEN_URL ||
            "https://test.vibrantscreen.in/api/infinite/generate_api_token",
        packageDetailsUrl: process.env.VIBRANT_PACKAGE_DETAILS_URL ||
            "https://test.vibrantscreen.in/api/infinite/get_package_details",
        initiateCaseUrl: process.env.VIBRANT_INITIATE_CASE_URL ||
            "https://test.vibrantscreen.in/api/infinite/initiate_case",
        clientSecret:
            process.env.VIBRANT_CLIENT_SECRET ||
            process.env.VIBRANT_CLIENTSECRET ||
            process.env.VIBRANT_SECRET,
        tokenPayload: process.env.VIBRANT_TOKEN_PAYLOAD || "",
        clientEntityName: process.env.VIBRANT_CLIENT_ENTITY_NAME || "Standard",
        clientRefNoPrefix: process.env.VIBRANT_CLIENT_REF_PREFIX || "BGV",
        initiatorName: process.env.VIBRANT_INITIATOR_NAME || "API",
        priorityCase: process.env.VIBRANT_PRIORITY_CASE || "No",
        loadChecksFromApi: String(process.env.VIBRANT_LOAD_CHECKS_FROM_API || "").toLowerCase() === "true"
    }
};