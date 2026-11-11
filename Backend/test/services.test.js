const assert = require("node:assert/strict");
const test = require("node:test");
const axios = require("axios");
const config = require("../src/config/config");
const {
    getEmployeeDetails,
    getEmployeeAttachment,
    getAllEmployeeAttachments
} = require("../src/services/successFactorsService");
const {
    findAuthToken,
    getCheckListItems,
    getVendorChecks,
    getVendorCatalog,
    initiateBGC
} = require("../src/services/vendorService");

test("normalizes nested Adamma checklist items and common field casing", () => {
    const checks = getCheckListItems({
        success: true,
        data: {
            clientContractComponents: [
                {
                    component: {
                        componentId: 72,
                        componentName: "Education Verification"
                    },
                    componentDescription: "Verify the qualification",
                    quantity: "2"
                },
                {
                    clientContractComponentId: "address",
                    clientContractComponentName: "Address Check"
                }
            ]
        }
    });

    assert.deepEqual(checks, [
        {
            id: "72",
            name: "Education Verification",
            description: "Verify the qualification",
            quantity: 2
        },
        {
            id: "address",
            name: "Address Check",
            description: "",
            quantity: 0
        }
    ]);
});

test("normalizes Adamma checklist responses containing check-name strings", () => {
    const checks = getCheckListItems([
        "SAM",
        "10 Panel Drug Abuse Test",
        "5 Panel Drug Abuse Test",
        "Credit Check"
    ]);

    assert.deepEqual(checks, [
        {
            id: "SAM",
            name: "SAM",
            description: "",
            quantity: 0
        },
        {
            id: "10 Panel Drug Abuse Test",
            name: "10 Panel Drug Abuse Test",
            description: "",
            quantity: 0
        },
        {
            id: "5 Panel Drug Abuse Test",
            name: "5 Panel Drug Abuse Test",
            description: "",
            quantity: 0
        },
        {
            id: "Credit Check",
            name: "Credit Check",
            description: "",
            quantity: 0
        }
    ]);
});

test("extracts Adamma auth tokens from nested API envelopes", () => {
    assert.equal(
        findAuthToken({
            success: true,
            data: {
                result: {
                    authCode: "test-token"
                }
            }
        }),
        "test-token"
    );
});

test("sends the generated Adamma token as a Bearer token for checklist retrieval", async () => {
    const originalPost = axios.post;
    const originalGet = axios.get;
    let authorization;

    axios.post = async (url, body) => {
        assert.equal(url, config.vendor.authUrl);
        assert.deepEqual(Object.keys(body).sort(), ["password", "userId"]);
        return {
            data: {
                data: {
                    authCode: "mock-adamma-token"
                }
            }
        };
    };

    axios.get = async (url, options) => {
        assert.equal(url, config.vendor.checklistUrl);
        authorization = options.headers.Authorization;
        return {
            data: ["Identity Check"]
        };
    };

    try {
        const checks = await getVendorChecks("Adamma");
        assert.equal(authorization, "Bearer mock-adamma-token");
        assert.equal(checks[0].name, "Identity Check");
        assert.equal(checks[0].id, "Identity Check");
    } finally {
        axios.post = originalPost;
        axios.get = originalGet;
    }
});

test("loads cFirst checks and packages using the generated access token", async () => {
    const originalGet = axios.get;
    const originalConfig = { ...config.cFirst };
    const requests = [];
    Object.assign(config.cFirst, {
        userName: "test-user",
        password: "test-password",
        apiKey: "test-api-key"
    });

    axios.get = async (url, options) => {
        requests.push({ url, options });
        if (url === config.cFirst.authenticationUrl) {
            return { data: { AccessToken: "mock-cfirst-token" } };
        }
        if (url === config.cFirst.packageListUrl) {
            return {
                data: {
                    GetPackageListResult: {
                        AlaCarteCheckList: [
                            { CheckId: 225, CheckName: "Credit" },
                            { CheckId: 226, CheckName: "Criminal" },
                            { CheckId: 227, CheckName: "Employment" },
                            { CheckId: 228, CheckName: "Identity" },
                            { CheckId: 229, CheckName: "Education" },
                            { CheckId: 230, CheckName: "Address" }
                        ],
                        Packages: [{
                            PackageId: 1013,
                            PackageName: "Freshers",
                            PackageDescription: "Test package",
                            PackagePrice: "1000"
                        }]
                    }
                }
            };
        }
        throw new Error(`Unexpected cFirst URL: ${url}`);
    };

    try {
        const catalog = await getVendorCatalog("cFirst");
        assert.deepEqual(requests[0].options.params, {
            UserName: "test-user",
            Password: "test-password",
            Apikey: "test-api-key"
        });
        assert.deepEqual(requests[1].options.params, {
            accesstoken: "mock-cfirst-token"
        });
        assert.deepEqual(catalog.checks.map(check => check.name), [
            "Credit",
            "Criminal",
            "Employment",
            "Identity",
            "Education"
        ]);
        assert.deepEqual(catalog.packages, [{
            id: "1013",
            name: "Freshers",
            description: "Test package",
            price: "1000"
        }]);
    } finally {
        axios.get = originalGet;
        Object.assign(config.cFirst, originalConfig);
    }
});

test("shows the five known cFirst checks when credentials are not configured", async () => {
    const originalGet = axios.get;
    const originalConfig = { ...config.cFirst };
    Object.assign(config.cFirst, {
        userName: "",
        password: "",
        apiKey: ""
    });
    axios.get = async () => {
        throw new Error("cFirst API should not be called without credentials");
    };

    try {
        const catalog = await getVendorCatalog("cFirst");
        assert.deepEqual(catalog.checks.map(check => [check.id, check.name]), [
            ["225", "Credit"],
            ["226", "Criminal"],
            ["227", "Employment"],
            ["228", "Identity"],
            ["229", "Education"]
        ]);
        assert.equal(catalog.packages.length, 16);
        assert.deepEqual(catalog.packages.find(item => item.id === "1259"), {
            id: "1259",
            name: "PRE BGV",
            description: "1 - CREDIT, 1 - CRIMINAL, 1 - EDUCATION, 1 - IDENTITY",
            price: "5000"
        });
        assert.match(catalog.warning, /Configure CFIRST_USER_NAME/);
    } finally {
        axios.get = originalGet;
        Object.assign(config.cFirst, originalConfig);
    }
});

test("loads known Parishram checks list", async () => {
    const checks = await getVendorChecks("parishram");
    assert.equal(checks.length, 12);
    assert.deepEqual(checks.map(item => item.name), [
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
    ]);
});

test("loads static vibrant checks when API loading is disabled", async () => {
    const originalPost = axios.post;
    const originalVibrantConfig = { ...config.vibrant };
    let called = false;
    Object.assign(config.vibrant, {
        loadChecksFromApi: false
    });

    axios.post = async () => {
        called = true;
        throw new Error("Should not call vibrant API when static checks are configured");
    };

    try {
        const catalog = await getVendorCatalog("vibrant");
        assert.equal(called, false);
        assert.deepEqual(catalog.checks.map(check => check.name), [
            "Identity Verification",
            "Address Verification",
            "Education Verification",
            "Employment Verification",
            "Reference Verification"
        ]);
        assert.equal(catalog.warning, undefined);
    } finally {
        axios.post = originalPost;
        Object.assign(config.vibrant, originalVibrantConfig);
    }
});

test("loads vibrant checks from package details API", async () => {
    const originalPost = axios.post;
    const originalVibrantConfig = { ...config.vibrant };
    const requests = [];
    Object.assign(config.vibrant, {
        tokenUrl: "https://test.vibrantscreen.in/api/infinite/generate_api_token",
        packageDetailsUrl: "https://test.vibrantscreen.in/api/infinite/get_package_details",
        clientSecret: "",
        tokenPayload: "{\"clientSecret\":\"vibrant-secret\"}"
    });

    axios.post = async (url, body) => {
        requests.push({ url, body });
        if (url === config.vibrant.tokenUrl) {
            return {
                data: {
                    success: "true",
                    apiToken: "mock-vibrant-token"
                }
            };
        }
        if (url === config.vibrant.packageDetailsUrl) {
            return {
                data: {
                    checks: [
                        "Employment Verification",
                        "Education Verification"
                    ]
                }
            };
        }
        throw new Error(`Unexpected URL: ${url}`);
    };

    try {
        const checks = await getVendorChecks("vibrant");
        assert.deepEqual(requests[0].body, { clientSecret: "vibrant-secret" });
        assert.deepEqual(checks.map(item => item.name), [
            "Employment Verification",
            "Education Verification"
        ]);
    } finally {
        axios.post = originalPost;
        Object.assign(config.vibrant, originalVibrantConfig);
    }
});

test("tries alternate vibrant package details endpoint when primary returns 404", async () => {
    const originalPost = axios.post;
    const originalVibrantConfig = { ...config.vibrant };
    const calls = [];
    Object.assign(config.vibrant, {
        tokenUrl: "https://test.vibrantscreen.in/api/fractal/generate_api_token",
        packageDetailsUrl: "https://test.vibrantscreen.in/api/infinite/get_package_details_BAD",
        clientSecret: "vibrant-secret",
        tokenPayload: ""
    });

    axios.post = async (url, body) => {
        calls.push(url);
        if (url === config.vibrant.tokenUrl) {
            return {
                data: {
                    success: "true",
                    apiToken: "mock-vibrant-token"
                }
            };
        }
        if (url === config.vibrant.packageDetailsUrl) {
            const error = new Error("Not found");
            error.response = {
                status: 404,
                statusText: "Not Found",
                data: "<html>404</html>"
            };
            throw error;
        }
        if (url === "https://test.vibrantscreen.in/api/fractal/get_package_details") {
            return {
                data: {
                    checks: ["Employment Verification"]
                }
            };
        }
        throw new Error(`Unexpected URL: ${url}`);
    };

    try {
        const checks = await getVendorChecks("vibrant");
        assert.equal(checks.length, 1);
        assert.equal(checks[0].name, "Employment Verification");
        assert.deepEqual(calls, [
            "https://test.vibrantscreen.in/api/fractal/generate_api_token",
            "https://test.vibrantscreen.in/api/infinite/get_package_details_BAD",
            "https://test.vibrantscreen.in/api/fractal/get_package_details"
        ]);
    } finally {
        axios.post = originalPost;
        Object.assign(config.vibrant, originalVibrantConfig);
    }
});

test("returns fallback vibrant checks list when package details endpoint is missing", async () => {
    const originalPost = axios.post;
    const originalVibrantConfig = { ...config.vibrant };
    Object.assign(config.vibrant, {
        tokenUrl: "https://test.vibrantscreen.in/api/infinite/generate_api_token",
        packageDetailsUrl: "https://test.vibrantscreen.in/api/infinite/missing_endpoint",
        clientSecret: "vibrant-secret",
        tokenPayload: "",
        loadChecksFromApi: true
    });

    axios.post = async (url) => {
        if (url === config.vibrant.tokenUrl) {
            return {
                data: {
                    success: "true",
                    apiToken: "mock-vibrant-token"
                }
            };
        }
        const error = new Error("Not found");
        error.response = {
            status: 404,
            statusText: "Not Found",
            data: "<html>404</html>"
        };
        throw error;
    };

    try {
        const catalog = await getVendorCatalog("vibrant");
        assert.equal(catalog.packages.length, 0);
        assert.deepEqual(catalog.checks.map(check => check.name), [
            "Identity Verification",
            "Address Verification",
            "Education Verification",
            "Employment Verification",
            "Reference Verification"
        ]);
        assert.equal(catalog.warning, "Using standard Vibrant checks.");
    } finally {
        axios.post = originalPost;
        Object.assign(config.vibrant, originalVibrantConfig);
    }
});

test("returns fallback vibrant checks list when package details endpoint returns 500", async () => {
    const originalPost = axios.post;
    const originalVibrantConfig = { ...config.vibrant };
    Object.assign(config.vibrant, {
        tokenUrl: "https://test.vibrantscreen.in/api/infinite/generate_api_token",
        packageDetailsUrl: "https://test.vibrantscreen.in/api/infinite/get_package_details",
        clientSecret: "vibrant-secret",
        tokenPayload: "",
        loadChecksFromApi: true
    });

    axios.post = async (url) => {
        if (url === config.vibrant.tokenUrl) {
            return {
                data: {
                    success: "true",
                    apiToken: "mock-vibrant-token"
                }
            };
        }
        const error = new Error("Internal Server Error");
        error.response = {
            status: 500,
            statusText: "Internal Server Error",
            data: {
                message: "Cannot redeclare class App\\Controllers\\Fractal"
            }
        };
        throw error;
    };

    try {
        const catalog = await getVendorCatalog("vibrant");
        assert.equal(catalog.packages.length, 0);
        assert.deepEqual(catalog.checks.map(check => check.name), [
            "Identity Verification",
            "Address Verification",
            "Education Verification",
            "Employment Verification",
            "Reference Verification"
        ]);
        assert.equal(catalog.warning, "Using standard Vibrant checks.");
    } finally {
        axios.post = originalPost;
        Object.assign(config.vibrant, originalVibrantConfig);
    }
});

test("initiates vibrant case with generated token", async () => {
    const originalPost = axios.post;
    const originalVibrantConfig = { ...config.vibrant };
    const requests = [];
    Object.assign(config.vibrant, {
        tokenUrl: "https://test.vibrantscreen.in/api/infinite/generate_api_token",
        initiateCaseUrl: "https://test.vibrantscreen.in/api/infinite/initiate_case",
        clientSecret: "vibrant-secret",
        clientEntityName: "Standard",
        clientRefNoPrefix: "BGV",
        initiatorName: "API",
        priorityCase: "No"
    });

    axios.post = async (url, body, options = {}) => {
        requests.push({ url, body, options });
        if (url === config.vibrant.tokenUrl) {
            return {
                data: {
                    success: "true",
                    apiToken: "mock-vibrant-token"
                }
            };
        }
        if (url === config.vibrant.initiateCaseUrl) {
            return {
                data: {
                    success: "true",
                    message: "Case initiated successfully.",
                    caseId: "CASE2026001"
                }
            };
        }
        throw new Error(`Unexpected URL: ${url}`);
    };

    try {
        const result = await initiateBGC({
            vendor: "vibrant",
            employeeId: "E123",
            candidateInfo: {
                employeeId: "E123",
                name: "Amit Kumar",
                email: "amit.kumar123@gmail.com",
                phone: "9891198911",
                joiningDate: "/Date(1735689600000+0000)/"
            }
        });
        assert.equal(requests[0].url, config.vibrant.tokenUrl);
        assert.deepEqual(requests[0].body, { clientSecret: "vibrant-secret" });
        assert.equal(requests[1].url, config.vibrant.initiateCaseUrl);
        assert.equal(requests[1].options.headers.apiToken, "mock-vibrant-token");
        assert.equal(requests[1].body.clientEntityName, "Standard");
        assert.equal(requests[1].body.empId, "E123");
        assert.equal(result.success, true);
        assert.equal(result.message, "Case initiated successfully.");
    } finally {
        axios.post = originalPost;
        Object.assign(config.vibrant, originalVibrantConfig);
    }
});

test("initiates Parishram case with generated token", async () => {
    const originalPost = axios.post;
    const originalFetch = global.fetch;
    const originalParishramConfig = { ...config.parishram };
    const tokenRequests = [];
    const caseRequests = [];
    Object.assign(config.parishram, {
        tokenUrl: "https://service.pess.co.in/BGV_API/GenerateToken.php",
        caseInitiateUrl: "https://service.pess.co.in/BGV_API/CaseInitiate.php",
        loginPayload: "",
        userName: "caseIniteU1_Allianz",
        password: "test-password",
        userId: "caseIniteU1_Allianz"
    });

    axios.post = async (url, body, options = {}) => {
        tokenRequests.push({ url, body, options });
        if (url === config.parishram.tokenUrl) {
            return {
                data: {
                    status: true,
                    code: 200,
                    message: "Token generated successfully.",
                    token: "mock-parishram-token"
                }
            };
        }
        throw new Error(`Unexpected URL: ${url}`);
    };

    global.fetch = async (url, options = {}) => {
        caseRequests.push({ url, options });
        return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () => JSON.stringify({
                status: true,
                code: 200,
                message: "Case submitted successfully."
            })
        };
    };

    try {
        const result = await initiateBGC({
            vendor: "parishram",
            employeeId: "E123",
            candidateInfo: {
                name: "Casey Candidate",
                dob: "/Date(325123200000+0000)/",
                fatherName: "Parent Name",
                email: "casey@example.com",
                phone: "9999999999",
                panNumber: "ABCDE1234F",
                aadhaarNumber: "123412341234"
            },
            selectedChecks: [
                { id: "Employment Credential Check", name: "Employment Credential Check" },
                { id: "Educational Qualification Check", name: "Educational Qualification Check" }
            ]
        });

        assert.equal(tokenRequests.length, 1);
        assert.equal(tokenRequests[0].url, config.parishram.tokenUrl);
        assert.deepEqual(tokenRequests[0].body, {
            userName: "caseIniteU1_Allianz",
            password: "test-password"
        });
        assert.equal(caseRequests.length, 1);
        assert.equal(caseRequests[0].url, config.parishram.caseInitiateUrl);
        assert.equal(caseRequests[0].options.headers.Authorization, "Bearer mock-parishram-token");
        assert.equal(caseRequests[0].options.headers["Content-Type"], "application/json");
        const casePayload = JSON.parse(caseRequests[0].options.body);
        assert.deepEqual(casePayload.checks, [
            "Employment Credential Check",
            "Educational Qualification Check"
        ]);
        assert.equal(casePayload.userId, "caseIniteU1_Allianz");
        assert.equal(result.success, true);
        assert.equal(result.message, "Case submitted successfully.");
    } finally {
        axios.post = originalPost;
        global.fetch = originalFetch;
        Object.assign(config.parishram, originalParishramConfig);
    }
});
test("submits cFirst candidate data mapped from SuccessFactors", async () => {
    const originalGet = axios.get;
    const originalPost = axios.post;
    const originalCFirstConfig = { ...config.cFirst };
    const originalSfBaseUrl = config.successFactors.baseUrl;
    let addCandidateBody;
    Object.assign(config.cFirst, {
        userName: "test-user",
        password: "test-password",
        apiKey: "test-api-key"
    });
    config.successFactors.baseUrl = "https://sf.test/odata/v2/cust_BGV";

    axios.get = async (url, options) => {
        if (url === config.cFirst.authenticationUrl) {
            return { data: { AccessToken: "mock-cfirst-token" } };
        }
        if (url === config.cFirst.packageListUrl) {
            return {
                data: {
                    GetPackageListResult: {
                        AlaCarteCheckList: [{ CheckId: 225, CheckName: "Credit" }],
                        Packages: [{
                            PackageId: 1013,
                            PackageName: "Freshers",
                            PackageDescription: "",
                            PackagePrice: "1000"
                        }]
                    }
                }
            };
        }
        if (url.endsWith("/cust_BGV")) {
            return {
                data: {
                    d: {
                        results: [{
                            externalCode: "BGV-REC-1",
                            cust_Employee_ID: "E123",
                            cust_CandidateEmail: "candidate@example.com",
                            cust_DOB: "/Date(325123200000+0000)/",
                            cust_PhoneNumber: "1234567890",
                            cust_Aadharnumber: "123412341234"
                        }]
                    }
                }
            };
        }
        if (url.endsWith("/PerPersonal")) {
            return {
                data: {
                    d: {
                        results: [{
                            firstName: "Casey",
                            middleName: "Q",
                            lastName: "Candidate"
                        }]
                    }
                }
            };
        }
        if (url.endsWith("/PerEmail")) {
            return { data: { d: { results: [{ emailAddress: "bgv@example.com" }] } } };
        }
        if (url.endsWith("/PerAddressDEFLT")) {
            return {
                data: {
                    d: {
                        results: [{
                            address1: "Main Road",
                            city: "Bengaluru",
                            state: "Karnataka",
                            country: "India",
                            zipCode: "560001"
                        }]
                    }
                }
            };
        }
        if (url.endsWith("/cust_PreviousEmploymentDetails")) {
            if (options.params.$filter.includes("PREV-1")) {
                return { data: { d: { results: [] } } };
            }
            return {
                data: {
                    d: {
                        results: [{
                            cust_Doyouhaveexperienceworkingwithanothercompany: "Y",
                            cust_NameofEmployer1: "Example Ltd",
                            cust_EMPDesignation1: "Engineer",
                            cust_Country1: "India",
                            cust_State1: "Karnataka",
                            cust_City1: "Bengaluru",
                            cust_From1: "/Date(1475366400000)/",
                            cust_To1: "/Date(1767225600000)/",
                            cust_ManagerName1: "Manager",
                            cust_ManagerEmail1: "manager@example.com",
                            cust_ManagerNo1: "12345",
                            cust_NameofEmployer2: "Second Employer",
                            cust_NameofEmployer3: "Third Employer",
                            cust_NameofEmployer4: "Fourth Employer"
                        }]
                    }
                }
            };
        }
        if (url.endsWith("/cust_INDEDUCATION")) {
            if (options.params.$filter.includes("BGV-REC-1")) {
                return { data: { d: { results: [] } } };
            }
            return {
                data: {
                    d: {
                        results: [{
                            cust_NameofInstitute1: "Example Institute",
                            cust_NameofUniversity1: "Example University",
                            cust_Qualification1: "10",
                            cust_Specialization1: "Business",
                            cust_Year1: "2010",
                            cust_NameofInstitute2: "Institute 2",
                            cust_NameofInstitute3: "Institute 3",
                            cust_NameofInstitute4: "Institute 4",
                            cust_NameofInstitute5: "Institute 5"
                        }]
                    }
                }
            };
        }
        if (url.endsWith("/cust_Attachment1Nav")) {
            return {
                data: {
                    d: {
                        results: [{
                            attachmentId: "ATT-1",
                            fileName: "degree.pdf",
                            mimeType: "application/pdf",
                            fileExtension: "pdf",
                            fileContent: "ZG9jdW1lbnQ="
                        }]
                    }
                }
            };
        }
        if (url.endsWith("/cust_Attachment2Nav")) {
            return {
                data: {
                    d: {
                        results: [{
                            attachmentId: "ATT-2",
                            fileName: "employment.pptx",
                            mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                            fileExtension: "pptx",
                            fileContent: "cHB0eC1kb2N1bWVudA=="
                        }]
                    }
                }
            };
        }
        if (url.endsWith("/cust_Attachment3Nav")) {
            return {
                data: {
                    d: {
                        results: [{
                            attachmentId: "ATT-3",
                            fileName: "Infinite.png ",
                            mimeType: "image/png; charset=binary",
                            fileExtension: " png ",
                            fileContent: "cG5nLWRvY3VtZW50"
                        }]
                    }
                }
            };
        }
        return { data: { d: { results: [] } } };
    };

    axios.post = async (url, body) => {
        assert.equal(url, config.cFirst.addCandidateUrl);
        addCandidateBody = body;
        return { data: { success: true } };
    };

    try {
        const result = await initiateBGC({
            vendor: "cFirst",
            employeeId: "E123",
            educationRecordId: "BGV-REC-1",
            personIdExternal: "E123",
            previousEmploymentId: "PREV-1",
            selectedDocs: [
                "BGV-REC-1-cust_Attachment1Nav-ATT-1",
                "BGV-REC-1-cust_Attachment2Nav-ATT-2",
                "BGV-REC-1-cust_Attachment3Nav-ATT-3"
            ],
            selectedChecks: [{
                id: "225",
                name: "Credit",
                quantity: 1,
                description: ""
            }],
            packageId: "1013",
            packageName: "Freshers"
        });
        const candidate = JSON.parse(addCandidateBody.Candidatejson)[0];
        assert.equal(addCandidateBody.accesstoken, "mock-cfirst-token");
        assert.equal(candidate.PackageName, "Freshers");
        assert.equal(candidate.PackageId, "1013");
        assert.match(candidate.APIReferenceCode, /^BGV-/);
        assert.equal(candidate.BGCResponseEmailIds, "bgv@example.com");
        assert.equal(candidate.EmployeeId, "BGV-REC-1");
        assert.equal(candidate.FirstName, "Casey");
        assert.equal(candidate.PrevEmployed, "Yes");
        assert.equal(candidate.MetaAddress[0].PostalCode, "560001");
        assert.equal(candidate.Employments.length, 4);
        assert.equal(candidate.Employments[0].Employer, "Example Ltd");
        assert.equal(candidate.Educations.length, 5);
        assert.equal(candidate.Educations[0].University, "Example University");
        assert.deepEqual(candidate.AlaCarteChecks, [{
            CheckId: 225,
            Quantity: 1,
            Remarks: ""
        }]);
        assert.deepEqual(candidate.Attachments, [
            {
                AttachmentId: 1,
                AttachmentType: "pdf",
                AttachmentName: "degree.pdf",
                AttachmentBody: "ZG9jdW1lbnQ="
            },
            {
                AttachmentId: 2,
                AttachmentType: "png",
                AttachmentName: "Infinite.png ",
                AttachmentBody: "cG5nLWRvY3VtZW50"
            }
        ]);
        assert.match(result.message, /Skipped unsupported attachments: employment\.pptx/);
        assert.doesNotMatch(result.message, /Infinite\.png/);
        assert.equal(result.success, true);
    } finally {
        axios.get = originalGet;
        axios.post = originalPost;
        Object.assign(config.cFirst, originalCFirstConfig);
        config.successFactors.baseUrl = originalSfBaseUrl;
    }
});

test("skips previous employment attachments when submitting to cFirst", async () => {
    const originalGet = axios.get;
    const originalPost = axios.post;
    const originalCFirstConfig = { ...config.cFirst };
    const originalSfBaseUrl = config.successFactors.baseUrl;
    let addCandidateBody;

    Object.assign(config.cFirst, {
        userName: "test-user",
        password: "test-password",
        apiKey: "test-api-key"
    });
    config.successFactors.baseUrl = "https://sf.test/odata/v2/cust_BGV";

    axios.get = async (url, options) => {
        if (url === config.cFirst.authenticationUrl) {
            return { data: { AccessToken: "mock-cfirst-token" } };
        }
        if (url === config.cFirst.packageListUrl) {
            return {
                data: {
                    GetPackageListResult: {
                        AlaCarteCheckList: [{ CheckId: 225, CheckName: "Credit" }],
                        Packages: [{
                            PackageId: 1013,
                            PackageName: "Freshers",
                            PackageDescription: "",
                            PackagePrice: "1000"
                        }]
                    }
                }
            };
        }
        if (url.endsWith("/cust_BGV")) {
            return {
                data: {
                    d: {
                        results: [{
                            externalCode: "BGV-REC-2",
                            cust_Employee_ID: "E222",
                            cust_CandidateEmail: "candidate@example.com",
                            cust_DOB: "/Date(325123200000+0000)/",
                            cust_PhoneNumber: "1234567890",
                            cust_Aadharnumber: "123412341234"
                        }]
                    }
                }
            };
        }
        if (url.endsWith("/PerPersonal")) {
            return { data: { d: { results: [{ firstName: "Ravi", lastName: "Kumar" }] } } };
        }
        if (url.endsWith("/PerEmail")) {
            return { data: { d: { results: [{ emailAddress: "bgv@example.com" }] } } };
        }
        if (url.endsWith("/PerAddressDEFLT")) {
            return { data: { d: { results: [{ address1: "Main Road", city: "Bengaluru", state: "Karnataka", country: "India", zipCode: "560001" }] } } };
        }
        if (url.endsWith("/cust_PreviousEmploymentDetails")) {
            return { data: { d: { results: [{ externalCode: "PREV-2", cust_Doyouhaveexperienceworkingwithanothercompany: "Y" }] } } };
        }
        if (url.endsWith("/cust_INDEDUCATION")) {
            return { data: { d: { results: [] } } };
        }
        if (url.includes("cust_INDEDUCATION") && url.includes("cust_Attachment1Nav")) {
            return {
                data: {
                    d: {
                        results: [{
                            attachmentId: "EDU-ATT",
                            fileName: "education.pdf",
                            mimeType: "application/pdf",
                            fileExtension: "pdf",
                            fileContent: "ZWR1Y2F0aW9u"
                        }]
                    }
                }
            };
        }
        if (url.includes("cust_PreviousEmploymentDetails") && url.includes("cust_Attachment1Nav")) {
            return { data: { d: { results: [{ attachmentId: "PREV-ATT", fileName: "prev.pdf", mimeType: "application/pdf", fileExtension: "pdf", fileContent: "cHJldg==" }] } } };
        }
        return { data: { d: { results: [] } } };
    };

    axios.post = async (url, body) => {
        assert.equal(url, config.cFirst.addCandidateUrl);
        addCandidateBody = body;
        return { data: { success: true } };
    };

    try {
        const result = await initiateBGC({
            vendor: "cFirst",
            employeeId: "E222",
            educationRecordId: "BGV-REC-2",
            personIdExternal: "E222",
            previousEmploymentId: "PREV-2",
            selectedDocs: [
                "PREV-2-cust_Attachment1Nav-PREV-ATT",
                "BGV-REC-2-cust_Attachment1Nav-EDU-ATT"
            ],
            selectedChecks: [{ id: "225", name: "Credit", quantity: 1, description: "" }],
            packageId: "1013",
            packageName: "Freshers"
        });
        const candidate = JSON.parse(addCandidateBody.Candidatejson)[0];
        assert.equal(candidate.Attachments.length, 1);
        assert.equal(candidate.Attachments[0].AttachmentName, "education.pdf");
        assert.match(result.message, /Previous Employment Details attachments were automatically excluded/i);
        assert.equal(result.success, true);
    } finally {
        axios.get = originalGet;
        axios.post = originalPost;
        Object.assign(config.cFirst, originalCFirstConfig);
        config.successFactors.baseUrl = originalSfBaseUrl;
    }
});

test("loads cust_BGV attachments using both record and employee IDs", async () => {
    const originalGet = axios.get;
    const originalBaseUrl = config.successFactors.baseUrl;
    const requestedFilters = [];
    config.successFactors.baseUrl = "https://example.test/odata/v2/cust_BGV";

    axios.get = async (url, options) => {
        if (url.endsWith("/cust_BGV")) {
            return {
                data: {
                    d: {
                        results: [{
                            externalCode: "BGV-17",
                            cust_Employee_ID: "1006001",
                            cust_EmployeeName: "Diana Louis"
                        }]
                    }
                }
            };
        }

        if (url.endsWith("/Attachment")) {
            requestedFilters.push(options.params.$filter);
            return {
                data: {
                    d: {
                        results: [{
                            attachmentId: "1037",
                            documentEntityType: "cust_BGV",
                            documentEntityId: "BGV-17",
                            fileName: "identity.pdf",
                            mimeType: "application/pdf"
                        }]
                    }
                }
            };
        }

        if (url.endsWith("/Attachment('1037')")) {
            return {
                data: {
                    d: {
                        attachmentId: "1037",
                        fileName: "identity.pdf",
                        mimeType: "application/pdf",
                        fileContent: Buffer.from("document").toString("base64")
                    }
                }
            };
        }

        throw new Error(`Unexpected SuccessFactors URL: ${url}`);
    };

    try {
        const details = await getEmployeeDetails("1006001");
        assert.equal(details.documents.length, 1);
        assert.equal(details.documents[0].attachmentId, "1037");
        assert.match(details.documents[0].downloadUrl, /1006001/);
        assert.match(requestedFilters[0], /documentEntityId eq 'BGV-17'/);
        assert.match(requestedFilters[0], /documentEntityId eq '1006001'/);

        const downloaded = await getEmployeeAttachment("1006001", "1037");
        assert.equal(downloaded.fileName, "identity.pdf");
        assert.equal(downloaded.content.toString(), "document");
    } finally {
        axios.get = originalGet;
        config.successFactors.baseUrl = originalBaseUrl;
    }
});

test("does not report an unconfigured vendor initiation as successful", async () => {
    await assert.rejects(
        initiateBGC({ vendor: "unknown-vendor" }),
        {
            message: "Vendor initiation is not configured for unknown-vendor",
            status: 501
        }
    );
});

test("continues previous-employment lookup when one filter uses an invalid property", async () => {
    const originalGet = axios.get;
    const originalBaseUrl = config.successFactors.baseUrl;
    config.successFactors.baseUrl = "https://sf.test/odata/v2/cust_BGV";

    axios.get = async (url, options = {}) => {
        if (url.includes("/PerNationalId")) {
            return { data: { d: { results: [] } } };
        }

        if (url.includes("/cust_PreviousEmploymentDetails") && !url.includes("/cust_Attachment")) {
            const filter = options.params?.$filter || "";
            if (filter.includes("externalCode eq 'PREV-1'")) {
                return { data: { d: { results: [] } } };
            }
            if (filter.includes("personIdExternal eq 'PREV-1'")) {
                const failure = new Error("invalid filter");
                failure.response = {
                    status: 400,
                    data: {
                        error: {
                            message: {
                                value: "[COE0021]Invalid property names: cust_PreviousEmploymentDetails/personIdExternal."
                            }
                        }
                    }
                };
                throw failure;
            }
            if (filter.includes("cust_Employee_ID eq 'PREV-1'")) {
                return { data: { d: { results: [{ externalCode: "PREV-1" }] } } };
            }
            return { data: { d: { results: [] } } };
        }

        if (url.includes("/cust_PreviousEmploymentDetails('PREV-1')/cust_Attachment1Nav")) {
            return {
                data: {
                    d: {
                        results: [{
                            attachmentId: "PREV-A1",
                            fileName: "experience-letter.pdf",
                            mimeType: "application/pdf",
                            fileExtension: "pdf",
                            fileContent: "ZG9j"
                        }]
                    }
                }
            };
        }
        if (url.includes("/cust_PreviousEmploymentDetails('PREV-1')/cust_Attachment")) {
            return { data: { d: { results: [] } } };
        }

        if (url.includes("/cust_INDEDUCATION('EDU-1')/cust_Attachment")) {
            return { data: { d: { results: [] } } };
        }

        throw new Error(`Unexpected SuccessFactors URL: ${url}`);
    };

    try {
        const result = await getAllEmployeeAttachments("EDU-1", "E123", "PREV-1");
        assert.equal(result.warnings.length, 0);
        assert.equal(result.documents.length, 1);
        assert.equal(result.documents[0].section, "Previous Employment Details");
        assert.equal(result.documents[0].attachmentId, "PREV-A1");
    } finally {
        axios.get = originalGet;
        config.successFactors.baseUrl = originalBaseUrl;
    }
});
