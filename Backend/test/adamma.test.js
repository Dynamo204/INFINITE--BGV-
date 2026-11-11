// const assert = require("node:assert/strict");
// const test = require("node:test");
// const axios = require("axios");
// const config = require("../src/config/config");
// const {
//     initiateBGC,
//     syncAdammaCaseStatus,
//     resolveAdammaClientNames
// } = require("../src/services/vendorService");

// const BGV_RECORD = {
//     __metadata: {
//         uri: "https://example.test/odata/v2/cust_BGV(effectiveStartDate=datetime'2026-11-02T00:00:00',externalCode='722')"
//     },
//     externalCode: "722",
//     effectiveStartDate: "/Date(1793577600000)/",
//     cust_Employee_ID: "1006001",
//     cust_EmployeeName: "Diana Louis",
//     cust_Client: "106",
//     cust_ClientNav: { label_defaultValue: "Oracle IMS", PickListV2_id: "ClientList" },
//     cust_CustomerLocation: "US",
//     cust_SBU: "HR Shared Services",
//     cust_Status: "02",
//     cust_Remarks: "Adamma case ATES137: INITIATED"
// };

// const STATUS_PICKLIST = [
//     { externalCode: "01", label_defaultValue: "Not Started" },
//     { externalCode: "02", label_defaultValue: "Initiated" },
//     { externalCode: "03", label_defaultValue: "In Progress" },
//     { externalCode: "05", label_defaultValue: "Completed" }
// ];

// function withMocks(overrides, fn) {
//     const saved = {
//         get: axios.get,
//         post: axios.post,
//         baseUrl: config.successFactors.baseUrl,
//         vendor: { ...config.vendor }
//     };
//     config.successFactors.baseUrl = "https://example.test/odata/v2/cust_BGV";
//     config.vendor.userId = "user@example.com";
//     config.vendor.password = "secret";
//     Object.assign(config.vendor, overrides.vendor || {});
//     axios.get = overrides.get;
//     axios.post = overrides.post;
//     return Promise.resolve(fn()).finally(() => {
//         axios.get = saved.get;
//         axios.post = saved.post;
//         config.successFactors.baseUrl = saved.baseUrl;
//         Object.keys(config.vendor).forEach(key => delete config.vendor[key]);
//         Object.assign(config.vendor, saved.vendor);
//     });
// }

// function sfGet(url) {
//     if (url.endsWith("/cust_BGV")) return { data: { d: { results: [BGV_RECORD] } } };
//     if (url.endsWith("/cust_StatusNav")) return { data: { d: { PickListV2_id: "BGVStatus" } } };
//     if (url.endsWith("/PickListValueV2")) return { data: { d: { results: STATUS_PICKLIST } } };
//     if (url.includes("cust_INDEDUCATION('722')/cust_Attachment1Nav")) {
//         return {
//             data: {
//                 d: {
//                     results: [{
//                         attachmentId: "9001",
//                         fileName: "degree.pdf",
//                         mimeType: "application/pdf",
//                         fileContent: Buffer.from("pdf").toString("base64")
//                     }]
//                 }
//             }
//         };
//     }
//     if (url.includes("cust_INDEDUCATION")) {
//         const error = new Error("not found");
//         error.response = { status: 404, data: {} };
//         throw error;
//     }
//     return { data: { d: { results: [] } } };
// }

// const PAYLOAD = {
//     employeeId: "1006001",
//     vendor: "Adamma",
//     preProfileNumber: "PP-1",
//     educationRecordId: "722",
//     personIdExternal: "1006001",
//     previousEmploymentId: "722",
//     candidateInfo: {
//         name: "Diana Louis",
//         employeeId: "1006001",
//         client: "Oracle IMS",
//         subBu: "HR Shared Services",
//         project: "HR",
//         location: "US"
//     },
//     selectedDocs: ["722-cust_Attachment1Nav-9001"],
//     selectedChecks: [{ id: "Identity", name: "Identity", quantity: 1 }]
// };

// test("uses the client name configured for Adamma instead of the SF client", () => {
//     const saved = { ...config.vendor };
//     try {
//         config.vendor.clientName = "Test";
//         config.vendor.subclientName = "Test";
//         config.vendor.clientMap = {};
//         config.vendor.subclientMap = {};
//         assert.deepEqual(resolveAdammaClientNames(PAYLOAD.candidateInfo), {
//             clientName: "Test",
//             subclientName: "Test"
//         });

//         config.vendor.clientMap = { "oracle ims": "ORACLE" };
//         assert.equal(resolveAdammaClientNames(PAYLOAD.candidateInfo).clientName, "ORACLE");

//         config.vendor.clientName = "";
//         config.vendor.subclientName = "";
//         config.vendor.clientMap = {};
//         assert.deepEqual(resolveAdammaClientNames(PAYLOAD.candidateInfo), {
//             clientName: "Oracle IMS",
//             subclientName: "HR Shared Services"
//         });
//     } finally {
//         Object.assign(config.vendor, saved);
//     }
// });

// test("initiates an Adamma case and writes the case status back to cust_BGV", async () => {
//     let sentForm;
//     let merge;

//     await withMocks({
//         vendor: { clientName: "Test", subclientName: "Test", clientMap: {}, subclientMap: {}, sfStatusMap: {}, sfCaseIdField: "" },
//         get: async url => sfGet(url),
//         post: async (url, body, options) => {
//             if (url === config.vendor.authUrl) return { data: { accessToken: "jwt" } };
//             if (url === config.vendor.initiationUrl) {
//                 sentForm = body;
//                 return { status: 201, data: { caseID: "ATES137", initiationDate: "2026-11-02T16:44:08.642Z", status: "INITIATED" } };
//             }
//             merge = { url, body, options };
//             return { status: 204, data: "" };
//         }
//     }, async () => {
//         const result = await initiateBGC(PAYLOAD);

//         assert.equal(sentForm.get("clientName"), "Test");
//         assert.equal(sentForm.get("subclientName"), "Test");
//         assert.equal(sentForm.get("location"), "US");
//         assert.equal(result.success, true);
//         assert.equal(result.caseId, "ATES137");
//         assert.match(result.message, /Adamma case ATES137 created \(INITIATED\)/);

//         assert.equal(
//             merge.url,
//             "https://example.test/odata/v2/cust_BGV(effectiveStartDate=datetime'2026-11-02T00:00:00',externalCode='722')"
//         );
//         assert.equal(merge.options.headers["X-HTTP-Method"], "MERGE");
//         assert.equal(merge.body.cust_Status, "02");
//         assert.equal(merge.body.cust_Remarks, "Adamma case ATES137: INITIATED");
//     });
// });

// test("reports a created Adamma case as success even when the SF update fails", async () => {
//     await withMocks({
//         vendor: { clientName: "Test", subclientName: "Test", sfStatusMap: { INITIATED: "02" } },
//         get: async url => sfGet(url),
//         post: async url => {
//             if (url === config.vendor.authUrl) return { data: { accessToken: "jwt" } };
//             if (url === config.vendor.initiationUrl) return { data: { caseID: "ATES138", status: "INITIATED" } };
//             const error = new Error("forbidden");
//             error.response = { status: 403, data: { error: { message: { value: "No permission" } } } };
//             throw error;
//         }
//     }, async () => {
//         const result = await initiateBGC(PAYLOAD);
//         assert.equal(result.success, true);
//         assert.equal(result.caseId, "ATES138");
//         assert.match(result.message, /could not be updated/);
//         assert.match(result.message, /Do not resubmit/);
//     });
// });

// test("explains the Adamma 'Client not found' error", async () => {
//     await withMocks({
//         vendor: { clientName: "", subclientName: "", clientMap: {}, subclientMap: {} },
//         get: async url => sfGet(url),
//         post: async url => {
//             if (url === config.vendor.authUrl) return { data: { accessToken: "jwt" } };
//             const error = new Error("404");
//             error.response = { status: 404, data: { error: "Client not found" }, statusText: "Not Found" };
//             throw error;
//         }
//     }, async () => {
//         await assert.rejects(initiateBGC(PAYLOAD), error => {
//             assert.match(error.message, /Client not found/);
//             assert.match(error.message, /no client "Oracle IMS"/);
//             assert.match(error.message, /ADAMMA_CLIENT_NAME/);
//             return true;
//         });
//     });
// });

// test("syncs the latest Adamma status to SF using the case ID stored in remarks", async () => {
//     let statusParams;
//     let merge;

//     await withMocks({
//         vendor: { sfStatusMap: {}, sfCaseIdField: "" },
//         get: async (url, options) => {
//             if (url === config.vendor.caseStatusUrl) {
//                 statusParams = options.params;
//                 return { data: { caseId: "ATES137", status: "COMPLETED", checkDetails: [{ componentName: "identitycheck" }] } };
//             }
//             return sfGet(url);
//         },
//         post: async (url, body) => {
//             if (url === config.vendor.authUrl) return { data: { accessToken: "jwt" } };
//             merge = body;
//             return { status: 204, data: "" };
//         }
//     }, async () => {
//         const result = await syncAdammaCaseStatus("1006001");
//         assert.deepEqual(statusParams, { caseid: "ATES137" });
//         assert.equal(result.status, "COMPLETED");
//         assert.equal(result.checkDetails.length, 1);
//         assert.equal(merge.cust_Status, "05");
//         assert.equal(merge.cust_Remarks, "Adamma case ATES137: COMPLETED");
//     });
// });


const assert = require("node:assert/strict");
const test = require("node:test");
const axios = require("axios");
const config = require("../src/config/config");
const {
    initiateBGC,
    syncAdammaCaseStatus,
    resolveAdammaClientNames
} = require("../src/services/vendorService");

const BGV_RECORD = {
    __metadata: {
        uri: "https://example.test/odata/v2/cust_BGV(effectiveStartDate=datetime'2026-11-02T00:00:00',externalCode='722')"
    },
    externalCode: "722",
    effectiveStartDate: "/Date(1793577600000)/",
    cust_Employee_ID: "1006001",
    cust_EmployeeName: "Diana Louis",
    cust_Client: "106",
    cust_ClientNav: { label_defaultValue: "Oracle IMS", PickListV2_id: "ClientList" },
    cust_CustomerLocation: "US",
    cust_SBU: "HR Shared Services",
    cust_Status: "02",
    cust_Remarks: "Adamma case ATES137: INITIATED"
};

const STATUS_PICKLIST = [
    { externalCode: "01", label_defaultValue: "Not Started" },
    { externalCode: "02", label_defaultValue: "Initiated" },
    { externalCode: "03", label_defaultValue: "In Progress" },
    { externalCode: "05", label_defaultValue: "Completed" }
];

function withMocks(overrides, fn) {
    const saved = {
        get: axios.get,
        post: axios.post,
        baseUrl: config.successFactors.baseUrl,
        vendor: { ...config.vendor }
    };
    config.successFactors.baseUrl = "https://example.test/odata/v2/cust_BGV";
    config.vendor.userId = "user@example.com";
    config.vendor.password = "secret";
    Object.assign(config.vendor, overrides.vendor || {});
    axios.get = overrides.get;
    axios.post = overrides.post;
    return Promise.resolve(fn()).finally(() => {
        axios.get = saved.get;
        axios.post = saved.post;
        config.successFactors.baseUrl = saved.baseUrl;
        Object.keys(config.vendor).forEach(key => delete config.vendor[key]);
        Object.assign(config.vendor, saved.vendor);
    });
}

function sfGet(url) {
    if (url.endsWith("/cust_BGV")) return { data: { d: { results: [BGV_RECORD] } } };
    if (url.endsWith("/cust_StatusNav")) return { data: { d: { PickListV2_id: "BGVStatus" } } };
    if (url.endsWith("/PickListValueV2")) return { data: { d: { results: STATUS_PICKLIST } } };
    if (url.includes("cust_INDEDUCATION('722')/cust_Attachment1Nav")) {
        return {
            data: {
                d: {
                    results: [{
                        attachmentId: "9001",
                        fileName: "degree.pdf",
                        mimeType: "application/pdf",
                        fileContent: Buffer.from("pdf").toString("base64")
                    }]
                }
            }
        };
    }
    if (url.includes("cust_INDEDUCATION")) {
        const error = new Error("not found");
        error.response = { status: 404, data: {} };
        throw error;
    }
    return { data: { d: { results: [] } } };
}

const PAYLOAD = {
    employeeId: "1006001",
    vendor: "Adamma",
    preProfileNumber: "PP-1",
    educationRecordId: "722",
    personIdExternal: "1006001",
    previousEmploymentId: "722",
    candidateInfo: {
        name: "Diana Louis",
        employeeId: "1006001",
        client: "Oracle IMS",
        subBu: "HR Shared Services",
        project: "HR",
        location: "US"
    },
    selectedDocs: ["722-cust_Attachment1Nav-9001"],
    selectedChecks: [{ id: "Identity", name: "Identity", quantity: 1 }]
};

test("uses the client name configured for Adamma instead of the SF client", () => {
    const saved = { ...config.vendor };
    try {
        config.vendor.clientName = "Test";
        config.vendor.subclientName = "Test";
        config.vendor.clientMap = {};
        config.vendor.subclientMap = {};
        assert.deepEqual(resolveAdammaClientNames(PAYLOAD.candidateInfo), {
            clientName: "Test",
            subclientName: "Test"
        });

        config.vendor.clientMap = { "oracle ims": "ORACLE" };
        assert.equal(resolveAdammaClientNames(PAYLOAD.candidateInfo).clientName, "ORACLE");

        config.vendor.clientName = "";
        config.vendor.subclientName = "";
        config.vendor.clientMap = {};
        assert.deepEqual(resolveAdammaClientNames(PAYLOAD.candidateInfo), {
            clientName: "Oracle IMS",
            subclientName: "HR Shared Services"
        });
    } finally {
        Object.assign(config.vendor, saved);
    }
});

test("initiates an Adamma case and writes the case status back to cust_BGV", async () => {
    let sentForm;
    let merge;

    await withMocks({
        vendor: { clientName: "Test", subclientName: "Test", clientMap: {}, subclientMap: {}, sfStatusMap: {}, sfCaseIdField: "" },
        get: async url => sfGet(url),
        post: async (url, body, options) => {
            if (url === config.vendor.authUrl) return { data: { accessToken: "jwt" } };
            if (url === config.vendor.initiationUrl) {
                sentForm = body;
                return { status: 201, data: { caseID: "ATES137", initiationDate: "2026-11-02T16:44:08.642Z", status: "INITIATED" } };
            }
            merge = { url, body, options };
            return { status: 200, data: { d: [{ status: "OK", editStatus: "UPSERTED", httpCode: 200 }] } };
        }
    }, async () => {
        const result = await initiateBGC(PAYLOAD);

        assert.equal(sentForm.get("clientName"), "Test");
        assert.equal(sentForm.get("subclientName"), "Test");
        assert.equal(sentForm.get("location"), "US");
        assert.equal(result.success, true);
        assert.equal(result.caseId, "ATES137");
        assert.match(result.message, /Adamma case ATES137 created \(INITIATED\)/);

        assert.equal(merge.url, "https://example.test/odata/v2/upsert");
        assert.deepEqual(merge.body, [{
            __metadata: { uri: "cust_BGV" },
            externalCode: "722",
            effectiveStartDate: "/Date(1793577600000)/",
            cust_Status: "02",
            cust_Remarks: "Adamma case ATES137: INITIATED"
        }]);
    });
});

test("reports a created Adamma case as success even when the SF update fails", async () => {
    await withMocks({
        vendor: { clientName: "Test", subclientName: "Test", sfStatusMap: { INITIATED: "02" } },
        get: async url => sfGet(url),
        post: async url => {
            if (url === config.vendor.authUrl) return { data: { accessToken: "jwt" } };
            if (url === config.vendor.initiationUrl) return { data: { caseID: "ATES138", status: "INITIATED" } };
            const error = new Error("forbidden");
            error.response = { status: 403, data: { error: { message: { value: "No permission" } } } };
            throw error;
        }
    }, async () => {
        const result = await initiateBGC(PAYLOAD);
        assert.equal(result.success, true);
        assert.equal(result.caseId, "ATES138");
        assert.match(result.message, /could not be updated/);
        assert.match(result.message, /Do not resubmit/);
    });
});

test("explains the Adamma 'Client not found' error", async () => {
    await withMocks({
        vendor: { clientName: "", subclientName: "", clientMap: {}, subclientMap: {} },
        get: async url => sfGet(url),
        post: async url => {
            if (url === config.vendor.authUrl) return { data: { accessToken: "jwt" } };
            const error = new Error("404");
            error.response = { status: 404, data: { error: "Client not found" }, statusText: "Not Found" };
            throw error;
        }
    }, async () => {
        await assert.rejects(initiateBGC(PAYLOAD), error => {
            assert.match(error.message, /Client not found/);
            assert.match(error.message, /no client "Oracle IMS"/);
            assert.match(error.message, /ADAMMA_CLIENT_NAME/);
            return true;
        });
    });
});

test("syncs the latest Adamma status to SF using the case ID stored in remarks", async () => {
    let statusParams;
    let merge;

    await withMocks({
        vendor: { sfStatusMap: {}, sfCaseIdField: "" },
        get: async (url, options) => {
            if (url === config.vendor.caseStatusUrl) {
                statusParams = options.params;
                return { data: { caseId: "ATES137", status: "COMPLETED", checkDetails: [{ componentName: "identitycheck" }] } };
            }
            return sfGet(url);
        },
        post: async (url, body) => {
            if (url === config.vendor.authUrl) return { data: { accessToken: "jwt" } };
            merge = body[0];
            return { status: 200, data: { d: [{ status: "OK", editStatus: "UPSERTED", httpCode: 200 }] } };
        }
    }, async () => {
        const result = await syncAdammaCaseStatus("1006001");
        assert.deepEqual(statusParams, { caseid: "ATES137" });
        assert.equal(result.status, "COMPLETED");
        assert.equal(result.checkDetails.length, 1);
        assert.equal(merge.cust_Status, "05");
        assert.equal(merge.cust_Remarks, "Adamma case ATES137: COMPLETED");
    });
});

test("treats an upsert row error as a failed SF update", async () => {
    await withMocks({
        vendor: { clientName: "Test", subclientName: "Test", sfStatusMap: { INITIATED: "02" } },
        get: async url => sfGet(url),
        post: async url => {
            if (url === config.vendor.authUrl) return { data: { accessToken: "jwt" } };
            if (url === config.vendor.initiationUrl) return { data: { caseID: "ATES139", status: "INITIATED" } };
            return { status: 200, data: { d: [{ status: "ERROR", httpCode: 400, message: "Invalid value for cust_Status" }] } };
        }
    }, async () => {
        const result = await initiateBGC(PAYLOAD);
        assert.equal(result.success, true);
        assert.match(result.message, /Invalid value for cust_Status/);
    });
});

test("employee list shows the cust_Status label and the Adamma case ID", async () => {
    const { getEmployees } = require("../src/services/successFactorsService");
    let expand;
    await withMocks({
        get: async (url, options) => {
            expand = options.params.$expand;
            return {
                data: {
                    d: {
                        results: [{
                            ...BGV_RECORD,
                            cust_StatusNav: { externalCode: "02", label_defaultValue: "Initiated" }
                        }]
                    }
                }
            };
        },
        post: async () => { throw new Error("unexpected"); }
    }, async () => {
        const [employee] = await getEmployees();
        assert.equal(expand, "cust_StatusNav");
        assert.equal(employee.status, "Initiated");
        assert.equal(employee.statusCode, "02");
        assert.equal(employee.adammaCaseId, "ATES137");
    });
});

test("an employee without a cust_INDEDUCATION record has no education documents instead of an error", async () => {
    const { getEducationAttachments } = require("../src/services/successFactorsService");
    await withMocks({
        get: async () => {
            const error = new Error("400");
            error.response = {
                status: 400,
                data: { error: { message: { value: "[COE0028]Record for entity cust_INDEDUCATION with key cust_INDEDUCATION/externalCode=1847 does not exist. Please check the key value." } } }
            };
            throw error;
        },
        post: async () => { throw new Error("unexpected"); }
    }, async () => {
        assert.deepEqual(await getEducationAttachments("1847"), []);
    });
});

test("other SuccessFactors 400 errors are still reported", async () => {
    const { getEducationAttachments } = require("../src/services/successFactorsService");
    await withMocks({
        get: async () => {
            const error = new Error("400");
            error.response = { status: 400, data: { error: { message: { value: "Invalid property names" } } } };
            throw error;
        },
        post: async () => { throw new Error("unexpected"); }
    }, async () => {
        await assert.rejects(getEducationAttachments("1847"), /HTTP 400/);
    });
});

test("reads cust_BGV as of today in India time, not UTC", async () => {
    const { getEmployees } = require("../src/services/successFactorsService");
    const RealDate = Date;
    // 00:20 IST on 3 Nov = 18:50 UTC on 2 Nov
    global.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : ["2026-11-02T18:50:00Z"])); }
        static now() { return new RealDate("2026-11-02T18:50:00Z").getTime(); }
    };
    let asOfDate;
    try {
        await withMocks({
            get: async (url, options) => {
                asOfDate = options.params.asOfDate;
                return { data: { d: { results: [BGV_RECORD] } } };
            },
            post: async () => { throw new Error("unexpected"); }
        }, async () => {
            await getEmployees();
        });
    } finally {
        global.Date = RealDate;
    }
    assert.equal(asOfDate, "2026-11-03");
});