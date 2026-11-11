import { useEffect, useRef, useState } from "react";

import "./App.css";

function resolveApiBaseUrl() {
    const configuredBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").trim();
    if (configuredBaseUrl) {
        return configuredBaseUrl.replace(/\/+$/, "");
    }

    if (typeof window !== "undefined") {
        const { hostname } = window.location;
        if (
            hostname === "localhost" ||
            hostname === "127.0.0.1" ||
            hostname === "[::1]"
        ) {
            return "http://localhost:3000";
        }
    }

    return "https://bgv-backend.cfapps.us10-001.hana.ondemand.com";
}

const API_BASE_URL = resolveApiBaseUrl();

const ALLOWED_LOGIN = {
    username: "btpdevteam@ikyam.com",
    password: "Infinite@123"
};

function apiUrl(path) {
    return `${API_BASE_URL}${path}`;
}

function formatSuccessFactorsDate(value) {
    const match = typeof value === "string"
        ? value.match(/^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/)
        : null;

    if (!match) {
        return value || "-";
    }

    const date = new Date(Number(match[1]));
    if (Number.isNaN(date.getTime())) {
        return "-";
    }

    return new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC"
    }).format(date);
}


// Login memory in this browser: the remembered email ("Remember me") and the
// signed-in session, so a page refresh does not log the user out.
// Browser storage can be blocked, so every access is guarded.
const REMEMBERED_EMAIL_KEY = "bgv.rememberedEmail";
const SESSION_KEY = "bgv.session";

function readStorage(storage, key) {
    try {
        return storage.getItem(key) || "";
    } catch {
        return "";
    }
}

function writeStorage(storage, key, value) {
    try {
        if (value) storage.setItem(key, value);
        else storage.removeItem(key);
    } catch {
        // storage not available: the app still works, it just does not remember
    }
}

// Signed-in user saved at login: localStorage with "Remember me", else this tab only
function readSavedSession() {
    return readStorage(window.localStorage, SESSION_KEY) || readStorage(window.sessionStorage, SESSION_KEY);
}

// Client dropdown with search: type to filter, click or Enter to pick.
function ClientPicker({ clients, value, loading, onChange }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const boxRef = useRef(null);

    const matches = clients.filter(client =>
        client.toLowerCase().includes(query.trim().toLowerCase())
    );

    useEffect(() => {
        if (!open) return undefined;
        function closeOnOutsideClick(event) {
            if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false);
        }
        document.addEventListener("mousedown", closeOnOutsideClick);
        return () => document.removeEventListener("mousedown", closeOnOutsideClick);
    }, [open]);

    function choose(client) {
        onChange(client);
        setOpen(false);
        setQuery("");
    }

    function handleKeyDown(event) {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive(index => Math.min(index + 1, Math.max(matches.length - 1, 0)));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive(index => Math.max(index - 1, 0));
        } else if (event.key === "Enter") {
            event.preventDefault();
            if (open && matches[active]) choose(matches[active]);
        } else if (event.key === "Escape") {
            setOpen(false);
        }
    }

    return (
        <div className="client-picker" ref={boxRef}>
            <input
                type="text"
                role="combobox"
                aria-expanded={open}
                aria-label="Client"
                aria-autocomplete="list"
                className="client-picker-input"
                value={open ? query : value}
                placeholder={loading ? "Loading clients…" : (value || "Search client")}
                onFocus={() => {
                    setOpen(true);
                    setQuery("");
                    setActive(0);
                }}
                onChange={event => {
                    setQuery(event.target.value);
                    setOpen(true);
                    setActive(0);
                }}
                onKeyDown={handleKeyDown}
            />
            {value && !open && (
                <button type="button" className="client-picker-clear" onClick={() => onChange("")} aria-label="Clear client">
                    ×
                </button>
            )}
            {open && (
                <ul className="client-picker-list" role="listbox">
                    {matches.length === 0 && (
                        <li className="client-picker-empty">
                            {loading ? "Loading clients…" : "No client matches"}
                        </li>
                    )}
                    {matches.map((client, index) => (
                        <li
                            key={client}
                            role="option"
                            aria-selected={client === value}
                            className={[
                                index === active ? "active" : "",
                                client === value ? "selected" : ""
                            ].join(" ").trim()}
                            onMouseDown={event => {
                                event.preventDefault();
                                choose(client);
                            }}
                            onMouseEnter={() => setActive(index)}
                        >
                            {client}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function App() {

    const savedSession = readSavedSession();
    const [screen, setScreen] = useState(savedSession ? 1 : 0);
    const [isAuthenticated, setIsAuthenticated] = useState(Boolean(savedSession));
    const [loggedInUser, setLoggedInUser] = useState(savedSession || "User");
    const [loginForm, setLoginForm] = useState(() => ({
        email: readStorage(window.localStorage, REMEMBERED_EMAIL_KEY),
        password: ""
    }));
    const [rememberMe, setRememberMe] = useState(() =>
        Boolean(readStorage(window.localStorage, REMEMBERED_EMAIL_KEY))
    );
    const [showPassword, setShowPassword] = useState(false);

    const [employees, setEmployees] =
        useState([]);

    const [showEmployeeInitiation, setShowEmployeeInitiation] = useState(false);
    const [employeeDirectory, setEmployeeDirectory] = useState([]);
    const [employeeDirectoryLoading, setEmployeeDirectoryLoading] = useState(false);
    const [employeeDirectoryError, setEmployeeDirectoryError] = useState("");
    const [employeeDirectoryFilters, setEmployeeDirectoryFilters] = useState({
        employeeId: "",
        name: "",
        manager: "",
        bu: "",
        client: "",
        status: "",
        profileNumber: "",
        project: ""
    });
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    const [newEmployeeName, setNewEmployeeName] = useState("");
    const [reportingManager, setReportingManager] = useState("");
    const [managerLoading, setManagerLoading] = useState(false);
    const [managerMessage, setManagerMessage] = useState("");
    const [newEmployeeBusinessUnit, setNewEmployeeBusinessUnit] = useState("");
    const [newEmployeeBusinessUnitCode, setNewEmployeeBusinessUnitCode] = useState("");
    const [businessUnitMessage, setBusinessUnitMessage] = useState("");
    const [newEmployeePrimaryProject, setNewEmployeePrimaryProject] = useState("");
    const [newEmployeeClient, setNewEmployeeClient] = useState("");
    const [creatingEmployee, setCreatingEmployee] = useState(false);
    const [createEmployeeError, setCreateEmployeeError] = useState("");
    const createEmployeeLock = useRef(false);

    const [employeeFilters, setEmployeeFilters] = useState({
        employeeId: "",
        name: "",
        manager: "",
        bu: "",
        client: "",
        status: "",
        profileNumber: "",
        project: ""
    });

    const [employeeInfo, setEmployeeInfo] =
        useState(null);

    const [documents, setDocuments] =
        useState([]);

    const [documentsLoading, setDocumentsLoading] =
        useState(false);

    const [documentsError, setDocumentsError] =
        useState("");

    const [checks, setChecks] =
        useState([]);

    const [checksLoading, setChecksLoading] =
        useState(false);

    const [checksError, setChecksError] =
        useState("");

    const [checksWarning, setChecksWarning] =
        useState("");

    const [packages, setPackages] =
        useState([]);

    const [selectedPackageId, setSelectedPackageId] =
        useState("");

    const [selectedDocuments, setSelectedDocuments] =
        useState([]);

    const [selectedChecks, setSelectedChecks] =
        useState([]);

    const [vendor, setVendor] =
        useState("Adamma");

    const [preProfileNumber, setPreProfileNumber] =
        useState("");

    const [previousEmploymentId, setPreviousEmploymentId] = useState("");

    const [loading, setLoading] =
        useState(false);

    const [message, setMessage] =
        useState("");

    const [messageType, setMessageType] =
        useState("error");

    const [syncingEmployeeId, setSyncingEmployeeId] = useState("");

    // Adamma case shown in the footer of the details screen
    const [vendorCase, setVendorCase] = useState(null);
    const [vendorCaseLoading, setVendorCaseLoading] = useState(false);
    // Popup with the new case right after "Submit to Vendor"
    const [submitPopup, setSubmitPopup] = useState(null);
    // Case details in the footer can be folded to just the status row
    const [footerCaseOpen, setFooterCaseOpen] = useState(true);
    // Client-wise checklist from RAP (Client List screen, Client dropdown, Client Checklist)
    const [clientChecklists, setClientChecklists] = useState([]);
    const [clientChecklistsLoading, setClientChecklistsLoading] = useState(false);
    const [clientChecklistsError, setClientChecklistsError] = useState("");
    const [clientChecklistsFetchedAt, setClientChecklistsFetchedAt] = useState("");
    const [clientSearch, setClientSearch] = useState("");
    // Add / delete in the client checklist (RAP)
    const [clientForm, setClientForm] = useState(null); // { client, checks: [], checkInput, error }
    const [clientConfirm, setClientConfirm] = useState(null); // { client, check }
    const [clientSaving, setClientSaving] = useState(false);
    const [clientNotice, setClientNotice] = useState("");
    const [selectedClient, setSelectedClient] = useState("");
    const [selectedClientChecks, setSelectedClientChecks] = useState([]);
    // Which list the "Checks to Initiate" section shows: "" (none yet, only
    // the two buttons), "client" or "vendor"
    const [checklistMode, setChecklistMode] = useState("");
    // "Already submitted?" box: case number of an older case, entered once
    const [linkCaseId, setLinkCaseId] = useState("");
    const [linkRefId, setLinkRefId] = useState("");
    const [linkError, setLinkError] = useState("");

    function clearMessage() {
        setMessage("");
    }

    function showError(text) {
        setMessageType("error");
        setMessage(text);
    }

    function showSuccess(text) {
        setMessageType("success");
        setMessage(text);
    }

    useEffect(() => {
        if (screen !== 2) {
            return;
        }

        if (!["adamma", "cfirst", "parishram", "vibrant"].includes(vendor.toLowerCase())) {
            setChecks([]);
            setSelectedChecks([]);
            setPackages([]);
            setSelectedPackageId("");
            setChecksLoading(false);
            setChecksError("");
            setChecksWarning("");
            return;
        }

        let cancelled = false;

        async function loadVendorChecks() {
            try {
                setChecksLoading(true);
                setChecksError("");
                setChecksWarning("");
                setChecks([]);
                setSelectedChecks([]);
                setPackages([]);
                setSelectedPackageId("");

                const response = await fetch(
                    apiUrl(`/api/vendor/checks?vendor=${encodeURIComponent(vendor)}`)
                );
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(
                        data.message || `Failed to load ${vendor} checks`
                    );
                }

                if (!Array.isArray(data.checks)) {
                    throw new Error(
                        "Vendor response did not include a valid checks list"
                    );
                }

                if (!cancelled) {
                    setChecks(data.checks);
                    setSelectedChecks([]);
                    setPackages(Array.isArray(data.packages) ? data.packages : []);
                    setChecksWarning(data.warning || "");
                }
            } catch (error) {
                if (!cancelled) {
                    setChecks([]);
                    setSelectedChecks([]);
                    setPackages([]);
                    setSelectedPackageId("");
                    setChecksError(error.message || `Failed to load ${vendor} checks`);
                    setChecksWarning("");
                }
            } finally {
                if (!cancelled) {
                    setChecksLoading(false);
                }
            }
        }

        loadVendorChecks();

        return () => {
            cancelled = true;
        };
    }, [screen, vendor]);


    // =====================================================
    // LOAD EMPLOYEES
    // =====================================================

    useEffect(() => {
        if (!isAuthenticated) {
            return;
        }

        loadEmployees();

    }, [isAuthenticated]);

    useEffect(() => {
        if (screen !== 4 || !showEmployeeInitiation) {
            return undefined;
        }

        let cancelled = false;
        async function loadSuccessFactorsDirectory() {
            try {
                setEmployeeDirectoryLoading(true);
                setEmployeeDirectoryError("");
                const response = await fetch(apiUrl("/api/employees/directory"));
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.message || "Failed to load SuccessFactors employees");
                }
                if (!cancelled) {
                    setEmployeeDirectory(Array.isArray(data.employees) ? data.employees : []);
                }
            } catch (error) {
                if (!cancelled) {
                    console.error(error);
                    setEmployeeDirectoryError(error.message || "Failed to load SuccessFactors employees");
                }
            } finally {
                if (!cancelled) setEmployeeDirectoryLoading(false);
            }
        }

        loadSuccessFactorsDirectory();
        return () => {
            cancelled = true;
        };
    }, [screen, showEmployeeInitiation]);

    useEffect(() => {
        if (screen !== 4 || !showEmployeeInitiation || !selectedEmployee) {
            setReportingManager("");
            setManagerLoading(false);
            setManagerMessage("");
            return undefined;
        }

        let cancelled = false;
        async function loadReportingManager() {
            try {
                setManagerLoading(true);
                setManagerMessage("");
                const response = await fetch(
                    apiUrl(`/api/employees/manager/${encodeURIComponent(selectedEmployee.employeeId)}`)
                );
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.message || "Failed to load reporting manager");
                }
                if (!cancelled) {
                    setNewEmployeeName(data.employeeName || selectedEmployee.name || "");
                    setReportingManager(data.managerName || "");
                    setNewEmployeeBusinessUnit(data.businessUnitName || "");
                    setNewEmployeeBusinessUnitCode(data.businessUnitCode || "");
                    setBusinessUnitMessage(
                        data.businessUnitName
                            ? ""
                            : "Business Unit name was not found in SuccessFactors."
                    );
                    setManagerMessage(
                        data.managerName ? "" : "No reporting manager was found in SuccessFactors."
                    );
                }
            } catch (error) {
                if (!cancelled) {
                    console.error(error);
                    setManagerMessage(error.message || "Failed to load reporting manager");
                    setBusinessUnitMessage("Business Unit could not be loaded from SuccessFactors.");
                    setNewEmployeeBusinessUnitCode("");
                }
            } finally {
                if (!cancelled) setManagerLoading(false);
            }
        }

        loadReportingManager();
        return () => {
            cancelled = true;
        };
    }, [screen, showEmployeeInitiation, selectedEmployee]);

    function handleLoginSubmit(event) {
        event.preventDefault();

        const email = loginForm.email.trim();
        const password = loginForm.password.trim();

        if (!email || !password) {
            showError("Please enter your email and password.");
            return;
        }

        const isAuthorizedUser =
            email.toLowerCase() === ALLOWED_LOGIN.username.toLowerCase() &&
            password === ALLOWED_LOGIN.password;

        if (!isAuthorizedUser) {
            showError("Invalid username or password.");
            return;
        }

        clearMessage();
        const userName = ALLOWED_LOGIN.username.split("@")[0] || "User";
        // "Remember me": keep the email and stay signed in after the browser is closed;
        // otherwise stay signed in only in this tab (a refresh does not log out)
        writeStorage(window.localStorage, REMEMBERED_EMAIL_KEY, rememberMe ? email : "");
        writeStorage(window.localStorage, SESSION_KEY, rememberMe ? userName : "");
        writeStorage(window.sessionStorage, SESSION_KEY, userName);
        setLoginForm({ email, password: "" });
        setShowPassword(false);
        setLoggedInUser(userName);
        setIsAuthenticated(true);
        setScreen(1);
    }

    function handleLogout() {
        setIsAuthenticated(false);
        setScreen(0);
        setShowEmployeeInitiation(false);
        writeStorage(window.localStorage, SESSION_KEY, "");
        writeStorage(window.sessionStorage, SESSION_KEY, "");
        // Keep the email in the box when "Remember me" was ticked
        setLoginForm({ email: readStorage(window.localStorage, REMEMBERED_EMAIL_KEY), password: "" });
        clearMessage();
    }

    function openEmployeeForm() {
        setEmployeeDirectory([]);
        setEmployeeDirectoryFilters({
            employeeId: "",
            name: "",
            manager: "",
            bu: "",
            client: "",
            status: "",
            profileNumber: "",
            project: ""
        });
        setEmployeeDirectoryError("");
        setSelectedEmployee(null);
        setNewEmployeeName("");
        setReportingManager("");
        setManagerMessage("");
        setNewEmployeeBusinessUnit("");
        setNewEmployeeBusinessUnitCode("");
        setBusinessUnitMessage("");
        setNewEmployeePrimaryProject("");
        setNewEmployeeClient("");
        setCreateEmployeeError("");
        setShowEmployeeInitiation(true);
        setScreen(4);
        clearMessage();
    }

    function closeEmployeeForm() {
        setShowEmployeeInitiation(false);
        setScreen(1);
        setCreateEmployeeError("");
    }

    async function handleEmployeeCreateSubmit(event) {
        event.preventDefault();
        if (createEmployeeLock.current) return;
        if (!selectedEmployee) {
            setCreateEmployeeError("Select an employee ID from the SuccessFactors results.");
            return;
        }
        if (!newEmployeeBusinessUnitCode || !newEmployeeBusinessUnit.trim()) {
            setCreateEmployeeError("Business Unit must be available from SuccessFactors.");
            return;
        }

        createEmployeeLock.current = true;
        setCreatingEmployee(true);
        setCreateEmployeeError("");
        try {
            const response = await fetch(apiUrl("/api/employees/initiate"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    employeeId: selectedEmployee.employeeId,
                    employeeName: newEmployeeName.trim(),
                    managerName: reportingManager.trim(),
                    businessUnitName: newEmployeeBusinessUnit.trim(),
                    businessUnitCode: newEmployeeBusinessUnitCode,
                    client: newEmployeeClient.trim(),
                    primaryProject: newEmployeePrimaryProject.trim()
                })
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || "Failed to create employee");
            }

            let refreshError = "";
            try {
                const listResponse = await fetch(apiUrl("/api/employees"));
                const listData = await listResponse.json();
                if (!listResponse.ok || !Array.isArray(listData.employees)) {
                    throw new Error(listData.message || "Employee list refresh failed");
                }
                setEmployees(listData.employees);
                setEmployeeFilters({
                    employeeId: "",
                    name: "",
                    manager: "",
                    bu: "",
                    client: "",
                    status: "",
                    profileNumber: "",
                    project: ""
                });
            } catch (error) {
                console.error(error);
                refreshError = " The BGV employee list could not be refreshed. Reload the page to see the new employee.";
            }

            setShowEmployeeInitiation(false);
            setScreen(1);
            if (refreshError) {
                showSuccess(`Employee Created Successfully.${refreshError}`);
            } else {
                showSuccess("Employee Created Successfully.");
            }
        } catch (error) {
            console.error(error);
            setCreateEmployeeError(error.message || "Failed to create employee");
        } finally {
            createEmployeeLock.current = false;
            setCreatingEmployee(false);
        }
    }

    // Date as DD/MM/YYYY for the case tracking footer
    function formatTrackingDate(value) {
        if (!value) return "-";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat("en-GB", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }).format(date);
    }

    // Date and time, e.g. "06/11/2026, 14:52", for "Last updated"
    function formatTrackingDateTime(value) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat("en-GB", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        }).format(date);
    }

    // Days since the case was initiated, counted against the 15-day turnaround

    // Latest status of a vendor case (Adamma, Parishram) for the footer of the
    // details screen. With an employeeId it also writes the status to cust_Status in SF.
    async function loadVendorCase(caseVendor, caseId, employeeId, refId = "", options = {}) {
        if (!caseId) return;
        try {
            setVendorCaseLoading(true);
            const response = employeeId
                ? await fetch(apiUrl("/api/vendor/sync-status"), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ vendor: caseVendor, employeeId, caseId, refId })
                })
                : await fetch(apiUrl(
                    `/api/vendor/case-status?vendor=${encodeURIComponent(caseVendor)}&caseId=${encodeURIComponent(caseId)}&refId=${encodeURIComponent(refId)}`
                ));
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || "Failed to load case status");
            }
            setVendorCase(previous => ({
                vendor: caseVendor,
                label: data.vendor || previous?.label || caseVendor,
                refId: data.refId || refId || previous?.refId || "",
                profileNumber: data.profileNumber || previous?.profileNumber || "",
                caseId: data.caseId || caseId,
                // The vendor's own words (Parishram: "Pending"); Adamma sends one status.
                status: data.vendorStatus || data.status || previous?.status || "",
                color: data.color || previous?.color || "",
                initiationDate:
                    data.initiationDate ||
                    (previous?.caseId === caseId ? previous.initiationDate : "") ||
                    "",
                remarks: Array.isArray(data.remarks)
                    ? data.remarks.join("; ")
                    : (previous?.caseId === caseId ? previous.remarks : "") || "",
                completionDate:
                    data.completionDate ||
                    (previous?.caseId === caseId ? previous.completionDate : "") ||
                    "",
                lastSyncedAt: data.lastSyncedAt || new Date().toISOString(),
                overallStatus: data.status || previous?.overallStatus || "",
                checks: Array.isArray(data.checks) ? data.checks : (previous?.checks || []),
                hasReport: Boolean(data.hasReport),
                // e.g. cFirst "Could not find file ...": status still updated
                error: data.vendorWarning || ""
            }));
            if (employeeId) {
                refreshEmployeesQuietly();
            }
        } catch (error) {
            console.error(error);
            if (options.throwOnError) {
                // Linking an old case: keep the screen as it is, show the error in the box
                throw error;
            }
            setVendorCase(previous => ({
                vendor: caseVendor,
                label: previous?.label || caseVendor,
                refId: refId || previous?.refId || "",
                profileNumber: previous?.profileNumber || "",
                caseId,
                status: previous?.caseId === caseId ? previous.status : "",
                color: previous?.caseId === caseId ? previous.color : "",
                initiationDate: previous?.caseId === caseId ? previous.initiationDate : "",
                remarks: previous?.caseId === caseId ? previous.remarks : "",
                completionDate: previous?.caseId === caseId ? previous.completionDate : "",
                lastSyncedAt: previous?.caseId === caseId ? previous.lastSyncedAt : "",
                overallStatus: previous?.caseId === caseId ? previous.overallStatus : "",
                checks: previous?.caseId === caseId ? previous.checks : [],
                hasReport: previous?.caseId === caseId ? previous.hasReport : false,
                error: error.message || "Failed to load case status"
            }));
        } finally {
            setVendorCaseLoading(false);
        }
    }

    // Reloads the employee list without the loading screen or messages,
    // so a new status shows after a submit or a sync.
    async function refreshEmployeesQuietly() {
        try {
            const response = await fetch(apiUrl("/api/employees"));
            const data = await response.json();
            if (response.ok && Array.isArray(data.employees)) {
                setEmployees(data.employees);
            }
        } catch (error) {
            console.error(error);
        }
    }

    const VENDOR_NAMES = { adamma: "Adamma", parishram: "Parishram", cfirst: "cFirst", vibrant: "Vibrant" };

    // Vendor case of a list row: case ID from SF "BGV Profile Number" (any vendor),
    // else an old Adamma case from Remarks.
    function getRowCase(employee) {
        if (employee.caseId && employee.caseVendor) {
            return { caseId: employee.caseId, vendor: employee.caseVendor };
        }
        if (employee.adammaCaseId) {
            return { caseId: employee.adammaCaseId, vendor: "adamma" };
        }
        return null;
    }

    // Gets the latest status from the vendor and writes it to SF.
    async function syncVendorStatus(employee) {
        const rowCase = getRowCase(employee);
        if (!rowCase) return;
        const vendorName = VENDOR_NAMES[rowCase.vendor] || rowCase.vendor;
        try {
            setSyncingEmployeeId(employee.employeeId);
            clearMessage();
            const response = await fetch(apiUrl("/api/vendor/sync-status"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    vendor: rowCase.vendor,
                    employeeId: employee.employeeId,
                    caseId: rowCase.caseId
                })
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || `Failed to refresh ${vendorName} status`);
            }
            const warnings = data.sfUpdate?.warnings?.length
                ? ` (${data.sfUpdate.warnings.join("; ")})`
                : "";
            const colour = data.color ? `, ${data.color}` : "";
            showSuccess(
                `${data.vendor || vendorName} case ${data.caseId}: ${data.vendorStatus || data.status}${colour}. ` +
                `Updated in SuccessFactors.${warnings}`
            );
            await refreshEmployeesQuietly();
        } catch (error) {
            console.error(error);
            showError(error.message || `Failed to refresh ${vendorName} status`);
        } finally {
            setSyncingEmployeeId("");
        }
    }

    async function loadEmployees() {

        try {

            setLoading(true);

            const response =
                await fetch(apiUrl("/api/employees"));

            const data = await response.json();

            if (!response.ok) {

                throw new Error(
                    data.message || "Failed to fetch employees"
                );

            }

            setEmployees(
                Array.isArray(data.employees)
                    ? data.employees
                    : []
            );


        } catch (error) {

            console.error(error);

            showError("Failed to load employees");

        } finally {

            setLoading(false);

        }

    }


    // =====================================================
    // OPEN BGC DETAILS
    // =====================================================

    async function loadEmployeeAttachments(info, employmentRecordId) {
        setDocuments([]);
        setDocumentsError("");
        setDocumentsLoading(true);

        const personIdExternal = String(info.employeeId || "");
        const attachmentQuery = new URLSearchParams({
            educationRecordId: info.id || info.employeeId,
            personIdExternal,
            previousEmploymentId: employmentRecordId
        });

        try {
            const response = await fetch(
                apiUrl(`/api/employee/attachments?${attachmentQuery}`)
            );
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || "Failed to load employee attachments");
            }

            const combinedDocuments = Array.isArray(data.documents) ? data.documents : [];
            setDocuments([
                ...new Map(combinedDocuments.map(document => [document.id, document])).values()
            ]);
            const warnings = Array.isArray(data.warnings) ? [...data.warnings] : [];
            if (combinedDocuments.length === 0 && warnings.length === 0) {
                warnings.push("No attachments were returned for this employee.");
            }
            setDocumentsError(warnings.join("; "));
        } catch (error) {
            setDocumentsError(error.message || "Failed to load employee attachments");
        } finally {
            setDocumentsLoading(false);
        }
    }

    async function openBgcDetails(employeeId) {

        try {

            setLoading(true);

            clearMessage();


            const response =
                await fetch(
                    apiUrl(`/api/employee/${encodeURIComponent(employeeId)}/bgc-details`)
                );

            const data = await response.json();

            if (!response.ok) {

                throw new Error(
                    data.message || "Failed to fetch BGC details"
                );

            }

            setEmployeeInfo(
                data.employeeInfo
            );

            // The employee's vendor case remembered by the portal: shown at once
            // (last known result), then refreshed live from the vendor below.
            const storedCase = data.vendorCase?.caseId ? data.vendorCase : null;
            setVendorCase(storedCase ? {
                vendor: storedCase.vendor,
                label: storedCase.vendorLabel || VENDOR_NAMES[storedCase.vendor] || storedCase.vendor,
                refId: storedCase.refId || "",
                profileNumber: storedCase.profileNumber || "",
                caseId: storedCase.caseId,
                status: storedCase.vendorStatus || storedCase.status || "",
                color: storedCase.color || "",
                initiationDate: storedCase.initiationDate || "",
                remarks: Array.isArray(storedCase.remarks) ? storedCase.remarks.filter(Boolean).join("; ") : "",
                completionDate: storedCase.completionDate || "",
                lastSyncedAt: storedCase.lastSyncedAt || "",
                overallStatus: storedCase.status || "",
                checks: Array.isArray(storedCase.checks) ? storedCase.checks : [],
                hasReport: Boolean(storedCase.hasReport),
                error: ""
            } : null);

            setScreen(2);

            const nationalIdPersonId = String(data.employeeInfo.employeeId || employeeId);
            const employmentRecordId = String(data.employeeInfo.id || nationalIdPersonId);
            setPreviousEmploymentId(employmentRecordId);
            await loadEmployeeAttachments(data.employeeInfo, employmentRecordId);

            setSelectedDocuments([]);

            setSelectedChecks([]);

            setPreProfileNumber("");
            setLinkCaseId("");
            setLinkRefId("");
            setLinkError("");

            // Client dropdown: preselect the client whose name matches the employee's
            // client or project; HR can change it
            setSelectedClientChecks([]);
            setChecklistMode("");
            const knownClients = clientChecklists.length ? clientChecklists : await loadClientChecklists();
            const employeeClientNames = [data.employeeInfo.client, data.employeeInfo.project]
                .map(value => String(value || "").trim().toLowerCase())
                .filter(value => value && value !== "-");
            const matchingClient = knownClients.find(item =>
                employeeClientNames.includes(item.client.trim().toLowerCase())
            );
            setSelectedClient(matchingClient ? matchingClient.client : "");

            // Vendor dropdown shows the vendor of the case
            const VENDOR_OPTIONS = { adamma: "Adamma", cfirst: "cFirst", parishram: "parishram", vibrant: "vibrant" };
            if (storedCase && VENDOR_OPTIONS[storedCase.vendor]) {
                setVendor(VENDOR_OPTIONS[storedCase.vendor]);
            }

            if (storedCase) {
                // Latest result from the vendor (also updates SuccessFactors)
                loadVendorCase(
                    storedCase.vendor,
                    storedCase.caseId,
                    data.employeeInfo.employeeId || employeeId,
                    storedCase.refId || ""
                );
            }

        } catch (error) {

            console.error(error);

            showError(error.message || "Failed to load BGC details");

        } finally {

            setDocumentsLoading(false);

            setLoading(false);

        }

    }

    // =====================================================
    // DOCUMENT SELECTION
    // =====================================================

    function toggleDocument(id) {

        setSelectedDocuments(
            previous => {

                if (
                    previous.includes(id)
                ) {

                    return previous.filter(
                        item => item !== id
                    );

                }


                return [
                    ...previous,
                    id
                ];

            }
        );

    }


    // =====================================================
    // CHECK SELECTION
    // =====================================================

    function toggleCheck(id) {

        setSelectedChecks(
            previous => {

                const existing =
                    previous.find(
                        item =>
                            item.id === id
                    );


                if (existing) {

                    return previous.filter(
                        item =>
                            item.id !== id
                    );

                }


                return [
                    ...previous,
                    {
                        id: id,
                        name: checks.find(check => check.id === id)?.name || String(id),
                        quantity: 1,
                        description:
                            checks.find(check => check.id === id)?.description || ""
                    }
                ];

            }
        );

    }

    function updateCheckDescription(id, description) {
        setChecks(previous =>
            previous.map(check =>
                check.id === id
                    ? { ...check, description }
                    : check
            )
        );

        setSelectedChecks(previous =>
            previous.map(check =>
                check.id === id
                    ? { ...check, description }
                    : check
            )
        );
    }


    // =====================================================
    // CHECK QUANTITY
    // =====================================================

    function updateQuantity(
        id,
        quantity
    ) {

        setSelectedChecks(
            previous =>
                previous.map(item => {

                    if (
                        item.id === id
                    ) {

                        return {
                            ...item,
                            quantity: Math.max(1, parseInt(quantity, 10) || 1)
                        };

                    }

                    return item;

                })
        );

    }


    // =====================================================
    // SUBMIT TO VENDOR
    // =====================================================

    async function submitToVendor() {

        try {

            clearMessage();


            if (!employeeInfo) {

                showError("Please select an employee");

                return;

            }


            if (vendor.toLowerCase() === "adamma" && !preProfileNumber.trim()) {
                showError("Please enter Pre Profile Number");

                return;

            }


            if (
                selectedDocuments.length === 0
            ) {

                showError("Please select at least one document");

                return;

            }


            if (
                selectedChecks.length === 0
            ) {

                showError("Please select at least one check under Vendor Checklist");
                setChecklistMode("vendor");

                return;

            }

            if (vendor.toLowerCase() === "cfirst" && !selectedPackageId) {
                showError("Please select a cFirst package");
                return;
            }


            setLoading(true);


            const payload = {

                employeeId:
                    employeeInfo.employeeId,

                vendor:
                    vendor,

                preProfileNumber:
                    preProfileNumber.trim(),

                docType:
                    "BrassRing",

                educationRecordId:
                    employeeInfo.id,

                personIdExternal: String(employeeInfo.employeeId),

                previousEmploymentId: previousEmploymentId.trim(),

                candidateInfo: {
                    name: employeeInfo.name,
                    employeeId: employeeInfo.employeeId,
                    dob: employeeInfo.dob,
                    fatherName: employeeInfo.fatherName,
                    aadhaarNumber: employeeInfo.aadhaarNumber,
                    panNumber: employeeInfo.panNumber,
                    email: employeeInfo.email,
                    phone: employeeInfo.phone,
                    client: employeeInfo.client,
                    project: employeeInfo.project,
                    secondaryProject: employeeInfo.secondaryProject,
                    joiningDate: employeeInfo.joiningDate
                },

                selectedDocs:
                    selectedDocuments,

                selectedChecks:
                    selectedChecks,

                packageId:
                    selectedPackageId,

                packageName:
                    packages.find(item => item.id === selectedPackageId)?.name || "",

                // Client chosen by HR and the client checks ticked (reference only)
                clientName: selectedClient,

                clientChecks: getClientChecks(selectedClient)
                    .filter(check => selectedClientChecks.includes(check.id))
                    .map(check => check.name)

            };


            const response =
                await fetch(
                    apiUrl("/api/vendor/initiate-bgc"),
                    {

                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify(payload)

                    }
                );


            const data =
                await response.json();


            if (!response.ok) {
                const details = data?.details && typeof data.details === "object"
                    ? data.details
                    : null;
                const context = [];
                if (details?.stage) {
                    context.push(`Stage: ${details.stage}`);
                }
                if (details?.vendorStatus) {
                    context.push(`Vendor HTTP: ${details.vendorStatus}`);
                }
                if (details?.vendorCode) {
                    context.push(`Code: ${details.vendorCode}`);
                }
                if (details?.vendorMessage) {
                    context.push(`Vendor message: ${details.vendorMessage}`);
                }
                if (details?.vendorDebug?.code) {
                    context.push(`Debug code: ${details.vendorDebug.code}`);
                }
                if (details?.vendorDebug?.status) {
                    context.push(`Debug status: ${details.vendorDebug.status}`);
                }
                if (details?.vendorDebug?.responseSnippet) {
                    context.push(`Debug response: ${details.vendorDebug.responseSnippet}`);
                }
                if (data?.requestId) {
                    context.push(`Request ID: ${data.requestId}`);
                }
                const baseMessage = data?.message || "BGC initiation failed";

                throw new Error(
                    `${baseMessage}${context.length > 0 ? ` (${context.join(" | ")})` : ""}`
                );

            }


            showSuccess(data.message || "Request completed.");

            if (data.caseId) {
                setVendorCase({
                    vendor,
                    label: data.vendor || vendor,
                    refId: data.refId || "",
                    profileNumber: data.profileNumber || "",
                    caseId: data.caseId,
                    status: data.vendorStatus || data.status || "",
                    color: data.color || "",
                    initiationDate: data.initiationDate || "",
                    remarks: "",
                    completionDate: "",
                    lastSyncedAt: new Date().toISOString(),
                    overallStatus: data.status || "INITIATED",
                    checks: [],
                    hasReport: false,
                    error: ""
                });
                // Check-by-check details of the new case
                loadVendorCase(vendor, data.caseId, employeeInfo?.employeeId, data.refId || "");
                setSubmitPopup({
                    vendorLabel: data.vendor || vendor,
                    isCFirst: String(vendor).toLowerCase() === "cfirst",
                    caseId: String(data.caseId),
                    refId: data.refId || "",
                    status: data.vendorStatus || data.status || "",
                    color: data.color || "",
                    initiationDate: data.initiationDate || new Date().toISOString(),
                    sfMessage: data.sfUpdate?.error
                        ? `SuccessFactors could not be updated: ${data.sfUpdate.error}`
                        : data.sfUpdate && !data.sfUpdate.skipped
                            ? "Status updated in SuccessFactors."
                            : ""
                });
            }

            refreshEmployeesQuietly();


        } catch (error) {

            console.error(error);

            showError(error.message || "BGC initiation failed");

        } finally {

            setLoading(false);

        }

    }


    // =====================================================
    // SCREEN 1
    // =====================================================

    const filteredEmployees = employees.filter(employee => {
        const values = {
            employeeId: employee.employeeId || employee.id,
            name: employee.name,
            manager: employee.manager,
            bu: employee.bu,
            client: employee.client,
            status: employee.status,
            profileNumber: getRowCase(employee)?.caseId || "",
            project: employee.project
        };

        return Object.entries(employeeFilters).every(([field, filter]) =>
            String(values[field] ?? "").toLowerCase().includes(filter.trim().toLowerCase())
        );
    });

    const filteredEmployeeDirectory = employeeDirectory.filter(employee => {
        const values = {
            employeeId: employee.employeeId,
            name: employee.name,
            manager: employee.manager,
            bu: employee.businessUnit,
            client: employee.client,
            status: employee.status,
            profileNumber: employee.profileNumber,
            project: employee.project
        };
        return Object.entries(employeeDirectoryFilters).every(([field, filter]) =>
            String(values[field] ?? "").toLowerCase().includes(filter.trim().toLowerCase())
        );
    });
    const existingEmployeeIds = new Set(
        employees.map(employee => String(employee.employeeId || employee.id || "").trim())
    );

    function selectDirectoryEmployee(employee) {
        if (employee && selectedEmployee?.employeeId === employee.employeeId) return;
        setSelectedEmployee(employee);
        setNewEmployeeName(employee?.name || "");
        setReportingManager("");
        setManagerMessage("");
        setNewEmployeeBusinessUnit("");
        setNewEmployeeBusinessUnitCode("");
        setBusinessUnitMessage("");
        setNewEmployeePrimaryProject("");
        setNewEmployeeClient("");
        setCreateEmployeeError("");
    }

    // =====================================================
    // BACKGROUND VERIFICATION CASE (shown when the employee has a case)
    // =====================================================

    // Client-wise checklist from RAP (cached by the backend for 5 minutes)
    async function loadClientChecklists(refresh = false) {
        try {
            setClientChecklistsLoading(true);
            setClientChecklistsError("");
            const response = await fetch(apiUrl(`/api/clients/checklists${refresh ? "?refresh=1" : ""}`));
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || "Failed to load the client checklist");
            }
            setClientChecklists(Array.isArray(data.clients) ? data.clients : []);
            setClientChecklistsFetchedAt(data.fetchedAt || new Date().toISOString());
            return Array.isArray(data.clients) ? data.clients : [];
        } catch (error) {
            console.error(error);
            setClientChecklistsError(error.message || "Failed to load the client checklist");
            return [];
        } finally {
            setClientChecklistsLoading(false);
        }
    }

    function openClientForm(client = "") {
        setClientNotice("");
        setClientForm({ client, checks: [], checkInput: "", error: "" });
    }

    function addFormCheck(text) {
        setClientForm(form => {
            if (!form) return form;
            const names = String(text ?? form.checkInput)
                .split(/[\n,/]/)
                .map(name => name.replace(/\s+/g, " ").trim())
                .filter(Boolean);
            const checks = [...form.checks];
            for (const name of names) {
                if (!checks.some(check => check.toLowerCase() === name.toLowerCase())) checks.push(name);
            }
            return { ...form, checks, checkInput: "", error: "" };
        });
    }

    function removeFormCheck(name) {
        setClientForm(form => form && { ...form, checks: form.checks.filter(check => check !== name) });
    }

    async function saveClientForm(event) {
        event.preventDefault();
        if (!clientForm || clientSaving) return;
        const pending = clientForm.checkInput.split(/[\n,/]/).map(name => name.trim()).filter(Boolean);
        const checks = [...clientForm.checks];
        for (const name of pending) {
            if (!checks.some(check => check.toLowerCase() === name.toLowerCase())) checks.push(name);
        }
        const client = clientForm.client.replace(/\s+/g, " ").trim();
        if (!client) {
            setClientForm({ ...clientForm, checks, checkInput: "", error: "Enter the client name." });
            return;
        }
        if (checks.length === 0) {
            setClientForm({ ...clientForm, checks, checkInput: "", error: "Add at least one check." });
            return;
        }
        try {
            setClientSaving(true);
            const response = await fetch(apiUrl("/api/clients/checklists"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ client, checks })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.success === false) {
                throw new Error(data.message || "The client checklist could not be saved");
            }
            setClientForm(null);
            const added = Array.isArray(data.added) ? data.added.length : checks.length;
            setClientNotice(data.created
                ? `Client ${data.client || client} added with ${added} check${added === 1 ? "" : "s"}.`
                : `${added} check${added === 1 ? "" : "s"} added to ${data.client || client}.`);
            await loadClientChecklists(true);
        } catch (error) {
            console.error(error);
            setClientForm(form => form && { ...form, checks, checkInput: "", error: error.message });
        } finally {
            setClientSaving(false);
        }
    }

    async function confirmClientDelete() {
        if (!clientConfirm || clientSaving) return;
        const { client, check } = clientConfirm;
        try {
            setClientSaving(true);
            const query = new URLSearchParams({ client, ...(check ? { check } : {}) });
            const response = await fetch(apiUrl(`/api/clients/checklists?${query}`), { method: "DELETE" });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.success === false) {
                throw new Error(data.message || "Delete failed");
            }
            setClientConfirm(null);
            setClientNotice(check ? `Check "${check}" deleted from ${client}.` : `Client ${client} deleted.`);
            await loadClientChecklists(true);
        } catch (error) {
            console.error(error);
            setClientConfirm({ ...clientConfirm, error: error.message });
        } finally {
            setClientSaving(false);
        }
    }

    function openClientList() {
        clearMessage();
        setClientSearch("");
        setClientForm(null);
        setClientConfirm(null);
        setClientNotice("");
        setScreen(3);
        if (clientChecklists.length === 0) loadClientChecklists();
    }

    function getClientChecks(clientName) {
        return clientChecklists.find(item => item.client === clientName)?.checks || [];
    }

    function toggleClientCheck(id) {
        setSelectedClientChecks(previous =>
            previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]
        );
    }

    // Links a case created before the portal remembered cases, then shows it.
    // The backend remembers it, so this is needed only once per employee.
    async function linkExistingCase() {
        const caseId = linkCaseId.trim();
        if (!caseId || !employeeInfo?.employeeId) return;
        setLinkError("");
        try {
            await loadVendorCase(vendor, caseId, employeeInfo.employeeId, linkRefId.trim(), { throwOnError: true });
            setLinkCaseId("");
            setLinkRefId("");
        } catch (error) {
            setLinkError(
                `${error.message || "Case not found"}. Check the case number and the vendor selected below.`
            );
        }
    }

    function getOverallBadge(caseInfo) {
        const status = String(caseInfo.overallStatus || "").toUpperCase();
        if (status === "COMPLETED") return { text: "Completed", tone: "done" };
        if (status === "FAILED") return { text: "Stopped / Failed", tone: "bad" };
        if (status === "INITIATED") return { text: "Initiated", tone: "progress" };
        if (status) return { text: "In Progress", tone: "progress" };
        return { text: caseInfo.status || "Status not loaded", tone: "neutral" };
    }

    function getCheckTone(status) {
        if (status === "Completed") return "done";
        if (status === "Insufficiency" || status === "Failed" || status === "Stopped") return "bad";
        return "progress";
    }

    function getReportUrl(caseInfo, download) {
        const query = new URLSearchParams({
            vendor: caseInfo.vendor,
            caseId: caseInfo.caseId,
            refId: caseInfo.refId || ""
        });
        if (download) query.set("download", "1");
        return apiUrl(`/api/vendor/report?${query}`);
    }

    function getTurnaround(caseInfo) {
        const TURNAROUND_DAYS = 15;
        const start = caseInfo.initiationDate ? new Date(caseInfo.initiationDate) : null;
        if (!start || Number.isNaN(start.getTime())) return { text: "-", percent: 0, late: false };
        const end = caseInfo.completionDate ? new Date(caseInfo.completionDate) : new Date();
        const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
        const days = Math.max(0, Math.round((endDay - startDay) / 86400000));
        return {
            text: `${days} of ${TURNAROUND_DAYS} days`,
            percent: Math.min(100, Math.round((days / TURNAROUND_DAYS) * 100)),
            late: days > TURNAROUND_DAYS
        };
    }

    function renderCaseSection() {
        const caseInfo = vendorCase;
        const badge = getOverallBadge(caseInfo);
        const checks = Array.isArray(caseInfo.checks) ? caseInfo.checks : [];
        const completedChecks = checks.filter(check => check.status === "Completed").length;
        const insufficiencies = checks.filter(check => check.status === "Insufficiency").length;
        const turnaround = getTurnaround(caseInfo);
        const isCFirst = String(caseInfo.vendor).toLowerCase() === "cfirst";
        const isCompleted = badge.text === "Completed";

        return (
            <div className="section case-section" aria-live="polite">
                <div className="section-header case-section-header">
                    Background Verification Case
                    <span className="case-section-vendor">· {caseInfo.label}</span>
                    <button
                        type="button"
                        className="case-collapse"
                        onClick={() => setFooterCaseOpen(open => !open)}
                        aria-expanded={footerCaseOpen}
                    >
                        {footerCaseOpen ? "▾ Hide details" : "▴ Show details"}
                    </button>
                </div>

                <div className="case-head">
                    <div className="case-id">
                        <span>BGV Profile Number</span>
                        <strong>{caseInfo.caseId}</strong>
                        {isCFirst && caseInfo.refId && <small>cFirst Ref ID {caseInfo.refId}</small>}
                    </div>
                    <span className={`case-badge case-badge-${badge.tone}`}>
                        {badge.tone === "done" ? "✓ " : ""}{badge.text}
                    </span>
                    {caseInfo.color && (
                        <span className={`case-badge case-badge-color-${caseInfo.color.toLowerCase()}`}>
                            <span className={`vendor-case-dot vendor-case-dot-${caseInfo.color.toLowerCase()}`} aria-hidden="true" />
                            Overall: {caseInfo.color}
                        </span>
                    )}
                    {insufficiencies > 0 && (
                        <span className="case-badge case-badge-bad">
                            {insufficiencies} Insufficiency – action needed
                        </span>
                    )}
                    <span className="case-head-spacer" />
                    {caseInfo.lastSyncedAt && (
                        <span className="case-updated">Last updated {formatTrackingDateTime(caseInfo.lastSyncedAt)}</span>
                    )}
                    <button
                        type="button"
                        className="case-button"
                        onClick={() => loadVendorCase(caseInfo.vendor, caseInfo.caseId, employeeInfo?.employeeId, caseInfo.refId)}
                        disabled={vendorCaseLoading}
                        title={`Get the latest status from ${caseInfo.label} and update SuccessFactors`}
                    >
                        {vendorCaseLoading ? "Refreshing..." : "↻ Refresh"}
                    </button>
                </div>

                {caseInfo.error && <div className="case-warning">{caseInfo.error}</div>}

                <div className="case-kpis">
                    <div className="case-kpi">
                        <span>Initiated On</span>
                        <strong>{formatTrackingDate(caseInfo.initiationDate)}</strong>
                    </div>
                    <div className="case-kpi">
                        <span>Completed On</span>
                        <strong>{caseInfo.completionDate ? formatTrackingDate(caseInfo.completionDate) : "—"}</strong>
                    </div>
                    <div className="case-kpi">
                        <span>Turnaround</span>
                        <strong className={turnaround.late ? "case-late" : undefined}>{turnaround.text}</strong>
                        <div className="case-bar">
                            <i className={turnaround.late ? "case-bar-late" : undefined} style={{ width: `${turnaround.percent}%` }} />
                        </div>
                    </div>
                    <div className="case-kpi">
                        <span>Checks Completed</span>
                        <strong>{checks.length ? `${completedChecks} of ${checks.length}` : "—"}</strong>
                        <div className="case-bar">
                            <i style={{ width: `${checks.length ? Math.round((completedChecks / checks.length) * 100) : 0}%` }} />
                        </div>
                    </div>
                    <div className="case-kpi">
                        <span>Vendor Status</span>
                        <strong>{vendorCaseLoading && !caseInfo.status ? "Loading..." : (caseInfo.status || "—")}</strong>
                    </div>
                </div>

                <div className="case-table-wrap">
                    <table className="case-table">
                        <thead>
                            <tr>
                                <th>Check</th>
                                <th>Status</th>
                                <th>Result</th>
                                <th>Vendor Remarks</th>
                                <th>Updated</th>
                            </tr>
                        </thead>
                        <tbody>
                            {checks.length === 0 && (
                                <tr>
                                    <td colSpan="5" className="case-empty">
                                        {vendorCaseLoading
                                            ? "Loading check details…"
                                            : "Check details appear after the first refresh."}
                                    </td>
                                </tr>
                            )}
                            {checks.map((check, index) => (
                                <tr key={`${check.name}-${index}`}>
                                    <td><strong>{check.name}</strong></td>
                                    <td>
                                        <span className={`case-badge case-badge-${getCheckTone(check.status)}`}>
                                            {check.status}
                                        </span>
                                    </td>
                                    <td>
                                        {check.color ? (
                                            <>
                                                <span className={`vendor-case-dot vendor-case-dot-${check.color.toLowerCase()}`} aria-hidden="true" />
                                                {check.color}
                                            </>
                                        ) : "—"}
                                    </td>
                                    <td>
                                        {check.remarks
                                            ? <span className={check.status === "Insufficiency" ? "case-remark-alert" : undefined}>{check.remarks}</span>
                                            : "—"}
                                        {check.raisedAt && (
                                            <small className="case-subtext">Raised {formatTrackingDate(check.raisedAt)}</small>
                                        )}
                                    </td>
                                    <td>{check.updatedAt ? formatTrackingDate(check.updatedAt) : "—"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="case-report">
                    <div className={`case-pdf ${caseInfo.hasReport ? "case-pdf-ready" : ""}`} aria-hidden="true">PDF</div>
                    <div className="case-report-text">
                        <strong>Final BGV Report</strong>
                        <span>
                            {caseInfo.hasReport
                                ? `Ready from ${caseInfo.label}`
                                : isCompleted
                                    ? `Not available yet from ${caseInfo.label}.`
                                    : `Available when ${caseInfo.label} completes all checks.`}
                        </span>
                    </div>
                    {caseInfo.hasReport && (
                        <div className="case-report-actions">
                            <a className="case-button" href={getReportUrl(caseInfo, false)} target="_blank" rel="noreferrer">
                                View
                            </a>
                            <a className="case-button case-button-primary" href={getReportUrl(caseInfo, true)}>
                                Download
                            </a>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    if (screen === 0) {

        return (

            <div className="app auth-shell">

                <div className="auth-card">

                    <div className="auth-brand">
                        <img className="auth-logo" src="/Infinite%20Triangle%20Orbit%20Logo.png" alt="Background verification logo" />
                        <div>
                            <p className="auth-kicker">Welcome back</p>
                            <h1>BGV Portal</h1>
                        </div>
                    </div>

                    {message && (

                        <div className={`message message-${messageType}`}>
                            {message}
                        </div>

                    )}

                    <form className="auth-form" onSubmit={handleLoginSubmit}>
                        <label className="auth-field" htmlFor="login-email">
                            <span>Email</span>
                            <input
                                id="login-email"
                                name="username"
                                type="email"
                                value={loginForm.email}
                                onChange={event => setLoginForm(current => ({ ...current, email: event.target.value }))}
                                placeholder="name@company.com"
                                autoComplete="username"
                                autoFocus={!loginForm.email}
                                required
                            />
                        </label>

                        <label className="auth-field" htmlFor="login-password">
                            <span>Password</span>
                            <span className="password-field">
                                <input
                                    id="login-password"
                                    name="password"
                                    type={showPassword ? "text" : "password"}
                                    value={loginForm.password}
                                    onChange={event => setLoginForm(current => ({ ...current, password: event.target.value }))}
                                    placeholder="Enter your password"
                                    autoComplete="current-password"
                                    autoFocus={Boolean(loginForm.email)}
                                    required
                                />
                                <button
                                    type="button"
                                    className="password-toggle"
                                    onClick={() => setShowPassword(value => !value)}
                                    aria-label={showPassword ? "Hide password" : "Show password"}
                                    aria-pressed={showPassword}
                                >
                                    {showPassword ? "Hide" : "Show"}
                                </button>
                            </span>
                        </label>

                        <label className="remember-me">
                            <input
                                type="checkbox"
                                checked={rememberMe}
                                onChange={event => setRememberMe(event.target.checked)}
                            />
                            <span>Remember me</span>
                        </label>

                        <button className="auth-button" type="submit">
                            Sign In
                        </button>
                    </form>

                    <p className="auth-footer">
                        Access to background verification documents and checks.
                    </p>

                </div>

            </div>

        );

    }

    // Initiate Employee: pick an employee from SuccessFactors and create the BGV record
    if (screen === 4) {
        return (
            <div className="app">
                <div className="header">
                    <div className="header-left">
                        <button className="logo-home-button" type="button" onClick={closeEmployeeForm} aria-label="Return to BGV employee list" title="Back">
                            <img className="app-logo" src="/Infinite%20Triangle%20Orbit%20Logo.png" alt="" />
                        </button>
                        <div>
                            <div className="header-title">Initiate Employee</div>
                            <div className="header-user">Select an employee from SuccessFactors</div>
                        </div>
                    </div>
                    <div className="header-actions">
                        <button className="back-button" type="button" onClick={closeEmployeeForm}>Back to BGV</button>
                        <button className="logout-button" type="button" onClick={handleLogout}>Logout</button>
                    </div>
                </div>

                <section className="employee-directory-screen">
                    {employeeDirectoryError && (
                        <div className="message message-error" role="alert">{employeeDirectoryError}</div>
                    )}
                    {createEmployeeError && (
                        <div className="message message-error" role="alert">{createEmployeeError}</div>
                    )}

                    {employeeDirectoryLoading ? (
                        <div className="loading">Loading employees from SuccessFactors...</div>
                    ) : !employeeDirectoryError && (
                        <form className="employee-directory-form" onSubmit={handleEmployeeCreateSubmit}>
                            <div className="table-container">
                                <table className="employee-directory-table">
                                    <thead>
                                        <tr>
                                            <th>Select</th>
                                            <th>Employee ID</th>
                                            <th>Employee Name</th>
                                            <th>Reporting Manager</th>
                                            <th>Business Unit</th>
                                            <th>Client</th>
                                            <th>Project</th>
                                            <th>Action</th>
                                        </tr>
                                        <tr className="employee-filter-row">
                                            <th />
                                            {[
                                                ["employeeId", "Filter ID"],
                                                ["name", "Filter name"],
                                                ["manager", "Filter manager"],
                                                ["bu", "Filter business unit"],
                                                ["client", "Filter client"],
                                                ["project", "Filter project"]
                                            ].map(([field, placeholder]) => (
                                                <th key={field}>
                                                    <input
                                                        type="search"
                                                        aria-label={placeholder}
                                                        placeholder={placeholder}
                                                        value={employeeDirectoryFilters[field]}
                                                        onKeyDown={event => {
                                                            if (event.key === "Enter") event.preventDefault();
                                                        }}
                                                        onChange={event => setEmployeeDirectoryFilters(current => ({
                                                            ...current,
                                                            [field]: event.target.value
                                                        }))}
                                                    />
                                                </th>
                                            ))}
                                            <th />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredEmployeeDirectory.map(employee => {
                                            const employeeId = String(employee.employeeId || "");
                                            const alreadyAdded = existingEmployeeIds.has(employeeId);
                                            const isSelected = selectedEmployee?.employeeId === employeeId;
                                            return (
                                                <tr
                                                    key={employeeId}
                                                    className={isSelected ? "employee-directory-selected" : ""}
                                                >
                                                    <td>
                                                        <input
                                                            type="checkbox"
                                                            aria-label={`Select employee ${employeeId}`}
                                                            checked={isSelected}
                                                            disabled={alreadyAdded || creatingEmployee}
                                                            onChange={() => selectDirectoryEmployee(isSelected ? null : employee)}
                                                        />
                                                    </td>
                                                    <td>{employeeId}</td>
                                                    <td>
                                                        {isSelected ? (
                                                            <input
                                                                aria-label="Employee Name"
                                                                value={newEmployeeName}
                                                                onChange={event => setNewEmployeeName(event.target.value)}
                                                                required
                                                            />
                                                        ) : employee.name || "-"}
                                                    </td>
                                                    <td>
                                                        {isSelected ? (
                                                            <div className="employee-directory-edit-field">
                                                                <input
                                                                    aria-label="Reporting Manager"
                                                                    value={reportingManager}
                                                                    onChange={event => setReportingManager(event.target.value)}
                                                                    placeholder={managerLoading ? "Loading..." : "Enter manager"}
                                                                />
                                                                {managerMessage && <span role="status">{managerMessage}</span>}
                                                            </div>
                                                        ) : employee.manager || ""}
                                                    </td>
                                                    <td>
                                                        {isSelected ? (
                                                            <div className="employee-directory-edit-field">
                                                                <input
                                                                    aria-label="Business Unit"
                                                                    value={newEmployeeBusinessUnit}
                                                                    onChange={event => setNewEmployeeBusinessUnit(event.target.value)}
                                                                    placeholder={managerLoading ? "Loading..." : "Enter business unit"}
                                                                    required
                                                                />
                                                                {businessUnitMessage && <span role="status">{businessUnitMessage}</span>}
                                                            </div>
                                                        ) : employee.businessUnit || ""}
                                                    </td>
                                                    <td>
                                                        {isSelected ? (
                                                            <input
                                                                aria-label="Client"
                                                                value={newEmployeeClient}
                                                                onChange={event => setNewEmployeeClient(event.target.value)}
                                                                placeholder="Enter client"
                                                            />
                                                        ) : employee.client}
                                                    </td>
                                                    <td>
                                                        {isSelected ? (
                                                            <input
                                                                aria-label="Primary Project"
                                                                value={newEmployeePrimaryProject}
                                                                onChange={event => setNewEmployeePrimaryProject(event.target.value)}
                                                                placeholder="Enter project"
                                                            />
                                                        ) : employee.project}
                                                    </td>
                                                    <td>
                                                        {alreadyAdded ? (
                                                            <button className="view-button" type="button" disabled>Already Added</button>
                                                        ) : isSelected ? (
                                                            <div className="employee-directory-actions">
                                                                <button
                                                                    className="submit-button"
                                                                    type="submit"
                                                                    disabled={creatingEmployee || managerLoading || !newEmployeeBusinessUnitCode}
                                                                >
                                                                    {creatingEmployee ? "Initiating..." : "Initiate"}
                                                                </button>
                                                                <button
                                                                    className="back-button"
                                                                    type="button"
                                                                    onClick={() => selectDirectoryEmployee(null)}
                                                                    disabled={creatingEmployee}
                                                                >
                                                                    Cancel
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                className="view-button"
                                                                type="button"
                                                                onClick={() => selectDirectoryEmployee(employee)}
                                                            >
                                                                Select
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {filteredEmployeeDirectory.length === 0 && (
                                            <tr>
                                                <td colSpan="8" className="no-employees">
                                                    {employeeDirectory.length
                                                        ? "No SuccessFactors employees match these filters."
                                                        : "No employees were returned by SuccessFactors."}
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </form>
                    )}
                </section>
            </div>
        );
    }

    if (screen === 3) {
        const query = clientSearch.trim().toLowerCase();
        const visibleClients = clientChecklists
            .map(item => ({
                ...item,
                matchingChecks: !query || item.client.toLowerCase().includes(query)
                    ? item.checks
                    : item.checks.filter(check => check.name.toLowerCase().includes(query))
            }))
            .filter(item => item.matchingChecks.length > 0);
        const totalChecks = clientChecklists.reduce((sum, item) => sum + item.checks.length, 0);
        const knownCheckNames = [...new Set(clientChecklists.flatMap(item => item.checks.map(check => check.name)))]
            .sort((a, b) => a.localeCompare(b));
        const formClient = clientForm
            ? clientChecklists.find(item => item.client.toLowerCase() === clientForm.client.trim().toLowerCase())
            : null;

        return (
            <div className="app">
                <div className="header">
                    <div className="header-left">
                        <button className="logo-home-button" type="button" onClick={() => setScreen(1)} aria-label="Go to home page" title="Home">
                            <img className="app-logo" src="/Infinite%20Triangle%20Orbit%20Logo.png" alt="" />
                        </button>
                        <div>
                            <div className="header-title">Background Verification Document Portal</div>
                            <div className="header-user">Signed in as {loggedInUser}</div>
                        </div>
                    </div>
                    <div className="header-actions">
                        <button className="back-button" type="button" onClick={() => setScreen(1)}>
                            &lt; BACK
                        </button>
                        <button className="logout-button" type="button" onClick={handleLogout}>
                            Logout
                        </button>
                    </div>
                </div>

                <div className="client-list-page">
                    <div className="client-list-toolbar">
                        <div>
                            <h2>Client Checklists</h2>
                            <p>
                                {clientChecklistsLoading
                                    ? "Loading from the client master…"
                                    : `${clientChecklists.length} clients · ${totalChecks} checks`}
                                {clientChecklistsFetchedAt && !clientChecklistsLoading && (
                                    <> · updated {formatTrackingDateTime(clientChecklistsFetchedAt)}</>
                                )}
                            </p>
                        </div>
                        <input
                            type="search"
                            className="client-search"
                            placeholder="Search client or check"
                            value={clientSearch}
                            onChange={event => setClientSearch(event.target.value)}
                            aria-label="Search client or check"
                        />
                        <button
                            type="button"
                            className="case-button"
                            onClick={() => loadClientChecklists(true)}
                            disabled={clientChecklistsLoading || clientSaving}
                        >
                            {clientChecklistsLoading ? "Refreshing..." : "↻ Refresh"}
                        </button>
                        <button
                            type="button"
                            className="case-button case-button-primary"
                            onClick={() => openClientForm()}
                            disabled={clientSaving}
                        >
                            + Add Client
                        </button>
                    </div>

                    {clientNotice && (
                        <div className="message message-success client-notice">
                            {clientNotice}
                            <button type="button" className="client-notice-close" onClick={() => setClientNotice("")} aria-label="Close">×</button>
                        </div>
                    )}

                    {clientForm && (
                        <form className="client-form" onSubmit={saveClientForm}>
                            <div className="client-form-head">
                                <h3>{formClient ? `Add checks to ${formClient.client}` : "Add client and checklist"}</h3>
                                <span>Saved straight to the client master (RAP).</span>
                            </div>
                            <div className="client-form-grid">
                                <label className="client-form-field">
                                    <span>Client name</span>
                                    <input
                                        type="text"
                                        list="client-name-options"
                                        value={clientForm.client}
                                        onChange={event => setClientForm({ ...clientForm, client: event.target.value, error: "" })}
                                        placeholder="e.g. Verizon CAD IND"
                                        maxLength={200}
                                        autoFocus
                                    />
                                    <datalist id="client-name-options">
                                        {clientChecklists.map(item => <option key={item.client} value={item.client} />)}
                                    </datalist>
                                    {formClient && (
                                        <small>Existing client · {formClient.checks.length} checks already. Only new checks are added.</small>
                                    )}
                                </label>
                                <div className="client-form-field">
                                    <span>Checks</span>
                                    <div className="client-form-check-input">
                                        <input
                                            type="text"
                                            list="client-check-options"
                                            value={clientForm.checkInput}
                                            onChange={event => setClientForm({ ...clientForm, checkInput: event.target.value, error: "" })}
                                            onKeyDown={event => {
                                                if (event.key === "Enter" || event.key === ",") {
                                                    event.preventDefault();
                                                    addFormCheck();
                                                }
                                            }}
                                            placeholder="Type a check and press Enter"
                                        />
                                        <datalist id="client-check-options">
                                            {knownCheckNames.map(name => <option key={name} value={name} />)}
                                        </datalist>
                                        <button type="button" className="case-button" onClick={() => addFormCheck()} disabled={!clientForm.checkInput.trim()}>
                                            Add
                                        </button>
                                    </div>
                                    <div className="client-check-chips client-form-chips">
                                        {clientForm.checks.length === 0 && <small>No checks added yet.</small>}
                                        {clientForm.checks.map(name => {
                                            const exists = formClient?.checks.some(check => check.name.toLowerCase() === name.toLowerCase());
                                            return (
                                                <span className={`client-check-chip${exists ? " client-check-chip-exists" : ""}`} key={name} title={exists ? "Client already has this check" : ""}>
                                                    {name}{exists ? " (already there)" : ""}
                                                    <button type="button" className="chip-remove" onClick={() => removeFormCheck(name)} aria-label={`Remove ${name}`}>×</button>
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                            {clientForm.error && <div className="message message-error">{clientForm.error}</div>}
                            <div className="client-form-actions">
                                <button type="button" className="case-button" onClick={() => setClientForm(null)} disabled={clientSaving}>
                                    Cancel
                                </button>
                                <button type="submit" className="case-button case-button-primary" disabled={clientSaving}>
                                    {clientSaving ? "Saving..." : "Save"}
                                </button>
                            </div>
                        </form>
                    )}

                    {clientChecklistsError && (
                        <div className="message message-error">{clientChecklistsError}</div>
                    )}

                    {!clientChecklistsLoading && !clientChecklistsError && visibleClients.length === 0 && (
                        <div className="client-list-empty">
                            {clientChecklists.length ? "No client or check matches your search." : "No client checklists found."}
                        </div>
                    )}

                    {visibleClients.length > 0 && (
                        <div className="client-table-wrap">
                            <table className="client-table">
                                <thead>
                                    <tr>
                                        <th className="client-table-no">#</th>
                                        <th className="client-table-name">Client</th>
                                        <th>Checklist</th>
                                        <th className="client-table-count">Checks</th>
                                        <th className="client-table-actions">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visibleClients.map((item, index) => (
                                        <tr key={item.client}>
                                            <td className="client-table-no">{index + 1}</td>
                                            <td className="client-table-name"><strong>{item.client}</strong></td>
                                            <td>
                                                <div className="client-check-chips">
                                                    {item.matchingChecks.map(check => (
                                                        <span className="client-check-chip" key={check.id}>
                                                            {check.name}
                                                            <button
                                                                type="button"
                                                                className="chip-remove"
                                                                onClick={() => setClientConfirm({ client: item.client, check: check.name })}
                                                                disabled={clientSaving}
                                                                aria-label={`Delete ${check.name} from ${item.client}`}
                                                                title="Delete this check"
                                                            >
                                                                ×
                                                            </button>
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                            <td className="client-table-count">{item.checks.length}</td>
                                            <td className="client-table-actions">
                                                <button type="button" className="case-button client-row-button" onClick={() => openClientForm(item.client)} disabled={clientSaving}>
                                                    + Check
                                                </button>
                                                <button type="button" className="case-button client-delete-button" onClick={() => setClientConfirm({ client: item.client })} disabled={clientSaving}>
                                                    Delete
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {clientConfirm && (
                    <div className="popup-backdrop" role="presentation" onClick={() => !clientSaving && setClientConfirm(null)}>
                        <div className="popup" role="dialog" aria-modal="true" aria-labelledby="client-delete-title" onClick={event => event.stopPropagation()}>
                            <div className="popup-header">
                                <span className="popup-check popup-warning" aria-hidden="true">!</span>
                                <h2 id="client-delete-title">{clientConfirm.check ? "Delete this check?" : "Delete this client?"}</h2>
                            </div>
                            <p className="popup-note">
                                {clientConfirm.check
                                    ? <>Check <strong>{clientConfirm.check}</strong> will be deleted from <strong>{clientConfirm.client}</strong> in the client master (RAP).</>
                                    : <>Client <strong>{clientConfirm.client}</strong> and all its checks will be deleted from the client master (RAP).</>}
                                {" "}This cannot be undone.
                            </p>
                            {clientConfirm.error && <div className="message message-error">{clientConfirm.error}</div>}
                            <div className="client-form-actions">
                                <button type="button" className="case-button" onClick={() => setClientConfirm(null)} disabled={clientSaving}>
                                    Cancel
                                </button>
                                <button type="button" className="case-button client-delete-confirm" onClick={confirmClientDelete} disabled={clientSaving}>
                                    {clientSaving ? "Deleting..." : "Delete"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    if (screen === 1) {

        return (

            <div className="app">

                <div className="header">
                    <div className="header-left">
                        <button className="logo-home-button" type="button" onClick={() => setScreen(1)} aria-label="Go to home page" title="Home">
                            <img className="app-logo" src="/Infinite%20Triangle%20Orbit%20Logo.png" alt="" />
                        </button>
                        <div>
                            <div className="header-title">Background Verification Document Portal</div>
                            <div className="header-user">Signed in as {loggedInUser}</div>
                        </div>
                    </div>

                    <div className="header-actions">
                        <button className="logout-button initiate-employee-button" type="button" onClick={openEmployeeForm}>
                            Initiate Employee
                        </button>
                        <button className="client-list-button" type="button" onClick={openClientList}>
                            Client List
                        </button>
                        <button className="logout-button" type="button" onClick={handleLogout}>
                            Logout
                        </button>
                    </div>
                </div>

                {message && (

                    <div className={`message message-${messageType}`}>
                        {message}
                    </div>

                )}

                {loading ? (

                    <div className="loading">
                        Loading...
                    </div>

                ) : (

                    <div className="table-container">

                        <table>

                            <thead>

                                <tr>

                                    <th>
                                        Employee ID
                                    </th>

                                    <th>
                                        Employee Name
                                    </th>

                                    <th>
                                        Reporting Manager
                                    </th>

                                    <th>
                                        Business Unit
                                    </th>

                                    <th>
                                        Client
                                    </th>

                                    <th>
                                        Status
                                    </th>

                                    <th>
                                        BGV Profile Number
                                    </th>

                                    <th>
                                        Project
                                    </th>

                                    <th>
                                        Action
                                    </th>

                                </tr>

                                <tr className="employee-filter-row">
                                    <th>
                                        <input aria-label="Filter by employee ID" placeholder="Filter ID" value={employeeFilters.employeeId} onChange={event => setEmployeeFilters(current => ({ ...current, employeeId: event.target.value }))} />
                                    </th>
                                    <th>
                                        <input aria-label="Filter by employee name" placeholder="Filter name" value={employeeFilters.name} onChange={event => setEmployeeFilters(current => ({ ...current, name: event.target.value }))} />
                                    </th>
                                    <th>
                                        <input aria-label="Filter by reporting manager" placeholder="Filter manager" value={employeeFilters.manager} onChange={event => setEmployeeFilters(current => ({ ...current, manager: event.target.value }))} />
                                    </th>
                                    <th>
                                        <input aria-label="Filter by business unit" placeholder="Filter business unit" value={employeeFilters.bu} onChange={event => setEmployeeFilters(current => ({ ...current, bu: event.target.value }))} />
                                    </th>
                                    <th>
                                        <input aria-label="Filter by client" placeholder="Filter client" value={employeeFilters.client} onChange={event => setEmployeeFilters(current => ({ ...current, client: event.target.value }))} />
                                    </th>
                                    <th>
                                        <input aria-label="Filter by status" placeholder="Filter status" value={employeeFilters.status} onChange={event => setEmployeeFilters(current => ({ ...current, status: event.target.value }))} />
                                    </th>
                                    <th>
                                        <input aria-label="Filter by BGV profile number" placeholder="Filter profile no." value={employeeFilters.profileNumber} onChange={event => setEmployeeFilters(current => ({ ...current, profileNumber: event.target.value }))} />
                                    </th>
                                    <th>
                                        <input aria-label="Filter by project" placeholder="Filter project" value={employeeFilters.project} onChange={event => setEmployeeFilters(current => ({ ...current, project: event.target.value }))} />
                                    </th>
                                    <th />
                                </tr>

                            </thead>


                            <tbody>

                                {filteredEmployees.map(
                                    employee => (

                                        <tr
                                            key={
                                                employee.id
                                            }
                                        >

                                            <td>
                                                {
                                                    employee.employeeId || employee.id
                                                }
                                            </td>

                                            <td>
                                                {
                                                    employee.name
                                                }
                                            </td>

                                            <td>
                                                {
                                                    employee.manager
                                                }
                                            </td>

                                            <td>
                                                {
                                                    employee.bu
                                                }
                                            </td>

                                            <td>
                                                {
                                                    employee.client
                                                }
                                            </td>

                                            <td>
                                                <div className="status-cell">
                                                    <span>{employee.status || "-"}</span>
                                                    {getRowCase(employee) && (
                                                        <button
                                                            type="button"
                                                            className="status-refresh-button"
                                                            onClick={() => syncVendorStatus(employee)}
                                                            disabled={syncingEmployeeId === employee.employeeId}
                                                            title={`Get the latest status of ${VENDOR_NAMES[getRowCase(employee).vendor] || ""} case ${getRowCase(employee).caseId} and update SuccessFactors`}
                                                        >
                                                            {syncingEmployeeId === employee.employeeId ? "Refreshing..." : "Refresh"}
                                                        </button>
                                                    )}
                                                </div>
                                            </td>

                                            <td>
                                                {getRowCase(employee) ? (
                                                    <>
                                                        <span className="profile-number">{getRowCase(employee).caseId}</span>
                                                        <div className="status-case-id">
                                                            {VENDOR_NAMES[getRowCase(employee).vendor] || getRowCase(employee).vendor}
                                                        </div>
                                                    </>
                                                ) : "-"}
                                            </td>

                                            <td>
                                                {
                                                    employee.project
                                                }
                                            </td>

                                            <td>

                                                <button
                                                    className="view-button"
                                                    onClick={() =>
                                                        openBgcDetails(
                                                            employee.employeeId
                                                        )
                                                    }
                                                    disabled={!employee.employeeId}
                                                >
                                                    View
                                                </button>

                                            </td>

                                        </tr>

                                    )
                                )}

                                {filteredEmployees.length === 0 && (
                                    <tr>
                                        <td colSpan="9" className="no-employees">No employees match these filters.</td>
                                    </tr>
                                )}

                            </tbody>

                        </table>

                    </div>

                )}

            </div>

        );

    }


    const sectionOrder = {
        "Personal Details": 0,
        "Education Details": 1,
        "Previous Employment Details": 2
    };
    const orderedDocuments = [...documents].sort(
        (first, second) => (sectionOrder[first.section] ?? 99) - (sectionOrder[second.section] ?? 99)
    );

    // =====================================================
    // SCREEN 2
    // =====================================================

    return (

        <div className={screen === 2 ? "app details-app" : "app"}>

            {submitPopup && (
                <div
                    className="popup-backdrop"
                    role="presentation"
                    onClick={() => setSubmitPopup(null)}
                    onKeyDown={event => event.key === "Escape" && setSubmitPopup(null)}
                >
                    <div
                        className="popup"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="submit-popup-title"
                        onClick={event => event.stopPropagation()}
                    >
                        <div className="popup-header">
                            <span className="popup-check" aria-hidden="true">✓</span>
                            <h2 id="submit-popup-title">Case submitted to {submitPopup.vendorLabel}</h2>
                        </div>
                        <dl className="popup-details">
                            <dt>BGV Profile Number</dt>
                            <dd className="popup-case-id">{submitPopup.caseId}</dd>
                            {submitPopup.isCFirst && submitPopup.refId && (
                                <>
                                    <dt>cFirst Ref ID</dt>
                                    <dd>{submitPopup.refId}</dd>
                                </>
                            )}
                            <dt>Vendor Status</dt>
                            <dd>{submitPopup.status || "-"}</dd>
                            <dt>Colour</dt>
                            <dd>
                                {submitPopup.color ? (
                                    <>
                                        <span
                                            className={`vendor-case-dot vendor-case-dot-${submitPopup.color.toLowerCase()}`}
                                            aria-hidden="true"
                                        />
                                        {submitPopup.color}
                                    </>
                                ) : "-"}
                            </dd>
                            <dt>Initiation Date</dt>
                            <dd>{formatTrackingDate(submitPopup.initiationDate)}</dd>
                        </dl>
                        {submitPopup.sfMessage && (
                            <p className="popup-note">{submitPopup.sfMessage}</p>
                        )}
                        <p className="popup-note">
                            The case ID is saved as BGV Profile Number. Use Refresh in Vendor Case Tracking
                            to get the latest status.
                        </p>
                        <button
                            type="button"
                            className="submit-button popup-ok"
                            onClick={() => setSubmitPopup(null)}
                            autoFocus
                        >
                            OK
                        </button>
                    </div>
                </div>
            )}

            <div className="details-header">

                <h2>
                    <button className="logo-home-button" type="button" onClick={() => { setScreen(1); clearMessage(); }} aria-label="Go to home page" title="Home">
                        <img className="app-logo" src="/Infinite%20Triangle%20Orbit%20Logo.png" alt="" />
                    </button>
                    <span>
                        <span className="header-title">Background Verification Document Portal</span>
                        <span className="header-user">Signed in as {loggedInUser}</span>
                    </span>
                </h2>

                <div className="header-actions">
                    <button
                        className="back-button"
                        onClick={() => {
                            setScreen(1);
                            clearMessage();
                        }}
                    >
                        &lt; BACK
                    </button>
                    <button className="logout-button" type="button" onClick={handleLogout}>
                        Logout
                    </button>
                </div>

            </div>


            {employeeInfo && (

                <div className="section">

                    <div className="section-header">
                        Employee Information
                    </div>

                    <div className="employee-info">

                        <div>
                            <strong>Name</strong>
                            <span>
                                {employeeInfo.name}
                            </span>

                            <strong>Project</strong>
                            <span>
                                {employeeInfo.project}
                            </span>
                        </div>


                        <div>
                            <strong>Employee ID</strong>
                            <span>
                                {employeeInfo.employeeId}
                            </span>

                            <strong>Client</strong>
                            <span>
                                <ClientPicker
                                    clients={clientChecklists.map(item => item.client)}
                                    value={selectedClient}
                                    loading={clientChecklistsLoading}
                                    onChange={client => {
                                        setSelectedClient(client);
                                        setSelectedClientChecks([]);
                                    }}
                                />
                                {clientChecklistsError && (
                                    <small className="client-select-error">{clientChecklistsError}</small>
                                )}
                            </span>
                        </div>


                        <div>
                            <strong>Manager</strong>
                            <span>
                                {employeeInfo.manager}
                            </span>

                            <strong>Joining Date</strong>
                            <span>
                                {formatSuccessFactorsDate(employeeInfo.joiningDate)}
                            </span>

                            <strong>BGV Profile Number</strong>
                            <span className="profile-number">
                                {vendorCase?.caseId
                                    ? `${vendorCase.caseId} (${vendorCase.label})`
                                    : "-"}
                            </span>
                        </div>

                    </div>

                </div>

            )}

            {employeeInfo && !vendorCase?.caseId && (
                <div className="section link-case">
                    <div className="link-case-text">
                        <strong>Already submitted to {VENDOR_NAMES[String(vendor).toLowerCase()] || vendor}?</strong>
                        <span>
                            Enter the BGV Profile Number (case ID) once to show its status here.
                            Choose the vendor in the Vendor field below first.
                        </span>
                    </div>
                    <input
                        type="text"
                        value={linkCaseId}
                        onChange={event => setLinkCaseId(event.target.value)}
                        placeholder="e.g. 61836 or ATES157"
                        aria-label="BGV Profile Number of the existing case"
                    />
                    {String(vendor).toLowerCase() === "cfirst" && (
                        <input
                            type="text"
                            value={linkRefId}
                            onChange={event => setLinkRefId(event.target.value)}
                            placeholder="cFirst Ref ID (optional)"
                            aria-label="cFirst Ref ID"
                        />
                    )}
                    <button
                        type="button"
                        className="case-button case-button-primary"
                        onClick={linkExistingCase}
                        disabled={vendorCaseLoading || !linkCaseId.trim()}
                    >
                        {vendorCaseLoading ? "Loading..." : "Get Status"}
                    </button>
                    {linkError && <div className="link-case-error">{linkError}</div>}
                </div>
            )}


            <div className="section submit-setup">
                <div className="section-header section-header-split">
                    <span>Vendor Submission</span>
                    <small>Choose the vendor and the details to send with this case</small>
                </div>

                <div className="configuration">

                    <div className="form-field">
                        <label htmlFor="vendor-select">Vendor</label>
                        <select
                            id="vendor-select"
                            value={vendor}
                            onChange={e => setVendor(e.target.value)}
                        >
                            <option value="Adamma">Adamma</option>
                            <option value="cFirst">cFirst</option>
                            <option value="parishram">Parishram</option>
                            <option value="vibrant">Vibrant</option>
                        </select>
                    </div>

                    <div className="form-field">
                        <label htmlFor="employment-id">Employment ID</label>
                        <input
                            id="employment-id"
                            type="text"
                            value={previousEmploymentId}
                            onChange={e => setPreviousEmploymentId(e.target.value)}
                            onBlur={() => employeeInfo && loadEmployeeAttachments(
                                employeeInfo,
                                previousEmploymentId.trim()
                            )}
                            placeholder="SuccessFactors externalCode"
                        />
                        <small>Documents reload when you leave this field.</small>
                    </div>

                    {vendor.toLowerCase() === "cfirst" && (
                        <div className="form-field">
                            <label htmlFor="cfirst-package">cFirst Package</label>
                            <select
                                id="cfirst-package"
                                value={selectedPackageId}
                                onChange={e => setSelectedPackageId(e.target.value)}
                                disabled={checksLoading || packages.length === 0}
                            >
                                <option value="">Select a package</option>
                                {packages.map(item => (
                                    <option key={item.id} value={item.id}>
                                        {item.name} ({item.price})
                                    </option>
                                ))}
                            </select>
                            {packages.find(item => item.id === selectedPackageId)?.description && (
                                <small>
                                    {packages.find(item => item.id === selectedPackageId).description}
                                </small>
                            )}
                        </div>
                    )}

                    {vendor.toLowerCase() !== "cfirst" && (
                        <div className="form-field">
                            <label htmlFor="pre-profile-number">Pre Profile Number</label>
                            <input
                                id="pre-profile-number"
                                type="text"
                                value={preProfileNumber}
                                onChange={e => setPreProfileNumber(e.target.value)}
                                placeholder="Enter pre profile number"
                            />
                        </div>
                    )}

                </div>
            </div>


            <div className="split-view">

                <div className="section">

                    <div className="section-header section-header-split">
                        <span>Documents to Attach</span>
                        {documents.length > 0 && (
                            <span className="section-count">
                                {selectedDocuments.length} of {documents.length} selected
                            </span>
                        )}
                    </div>

                    <table className="documents-table">

                        <thead>

                            <tr>

                                <th>
                                    Select
                                </th>

                                <th>
                                    Type
                                </th>

                                <th>
                                    Attachment
                                </th>

                            </tr>

                        </thead>


                        <tbody>

                            {orderedDocuments.flatMap((document, index) => [
                                (index === 0 || document.section !== orderedDocuments[index - 1].section) && (
                                    <tr className="document-group-heading" key={`section-${document.section}`}>
                                        <td colSpan="3">{document.section || "Other Documents"}</td>
                                    </tr>
                                ),
                                <tr key={document.id}>

                                        <td>

                                            <input
                                                type="checkbox"
                                                checked={
                                                    selectedDocuments.includes(
                                                        document.id
                                                    )
                                                }
                                                onChange={() =>
                                                    toggleDocument(
                                                        document.id
                                                    )
                                                }
                                            />

                                        </td>

                                        <td>
                                            {
                                                document.type
                                            }
                                        </td>

                                        <td>
                                            <a
                                                href={document.fileContent
                                                    ? `data:${document.mimeType || "application/octet-stream"};base64,${document.fileContent.replace(/\s/g, "")}`
                                                    : undefined}
                                                target="_blank"
                                                rel="noreferrer"
                                                download={document.fileName}
                                            >
                                                {document.file}
                                            </a>
                                        </td>

                                </tr>
                            ])}

                            {documentsLoading && (
                                <tr><td colSpan="3">Loading attachments…</td></tr>
                            )}

                            {!documentsLoading && documentsError && (
                                <tr><td colSpan="3">{documentsError}</td></tr>
                            )}

                            {!documentsLoading && !documentsError && documents.length === 0 && (
                                <tr>
                                    <td colSpan="3">
                                        No attachments were returned.
                                    </td>
                                </tr>
                            )}

                        </tbody>

                    </table>

                </div>


                <div className="section">

                    <div className="section-header checks-header">
                        <span>Checks to Initiate</span>
                        {checklistMode && (
                        <div className="checklist-toggle" role="tablist" aria-label="Checklist">
                            <button
                                type="button"
                                role="tab"
                                aria-selected={checklistMode === "client"}
                                className={checklistMode === "client" ? "active" : ""}
                                onClick={() => {
                                    setChecklistMode("client");
                                    if (clientChecklists.length === 0 && !clientChecklistsLoading) loadClientChecklists();
                                }}
                            >
                                Client Checklist
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={checklistMode === "vendor"}
                                className={checklistMode === "vendor" ? "active" : ""}
                                onClick={() => setChecklistMode("vendor")}
                            >
                                Vendor Checklist
                            </button>
                        </div>
                        )}
                    </div>

                    {!checklistMode && (
                        <div className="checklist-choose">
                            <strong>Choose a checklist</strong>
                            <span>
                                Click <b>Client Checklist</b> to see the checks the client needs, or
                                <b> Vendor Checklist</b> to select the checks to send to {VENDOR_NAMES[String(vendor).toLowerCase()] || vendor}.
                            </span>
                            <div className="checklist-choose-buttons">
                                <button
                                    type="button"
                                    className="case-button"
                                    onClick={() => {
                                        setChecklistMode("client");
                                        if (clientChecklists.length === 0 && !clientChecklistsLoading) loadClientChecklists();
                                    }}
                                >
                                    Client Checklist
                                </button>
                                <button
                                    type="button"
                                    className="case-button case-button-primary"
                                    onClick={() => setChecklistMode("vendor")}
                                >
                                    Vendor Checklist
                                </button>
                            </div>
                        </div>
                    )}

                    {checklistMode === "client" && (
                        <table className="checks-table client-checks-table">
                            <thead>
                                <tr>
                                    <th>Select</th>
                                    <th>Check Name</th>
                                    <th>Client</th>
                                </tr>
                            </thead>
                            <tbody>
                                {clientChecklistsLoading && (
                                    <tr><td colSpan="3">Loading client checklist…</td></tr>
                                )}
                                {!clientChecklistsLoading && clientChecklistsError && (
                                    <tr><td colSpan="3">{clientChecklistsError}</td></tr>
                                )}
                                {!clientChecklistsLoading && !clientChecklistsError && !selectedClient && (
                                    <tr>
                                        <td colSpan="3" className="client-checks-hint">
                                            Select the client in Employee Information to see its checklist.
                                        </td>
                                    </tr>
                                )}
                                {!clientChecklistsLoading && selectedClient && getClientChecks(selectedClient).length === 0 && (
                                    <tr><td colSpan="3">No checks are set up for {selectedClient}.</td></tr>
                                )}
                                {selectedClient && getClientChecks(selectedClient).map(check => (
                                    <tr key={check.id}>
                                        <td>
                                            <input
                                                type="checkbox"
                                                checked={selectedClientChecks.includes(check.id)}
                                                onChange={() => toggleClientCheck(check.id)}
                                                aria-label={check.name}
                                            />
                                        </td>
                                        <td>{check.name}</td>
                                        <td className="client-checks-client">{selectedClient}</td>
                                    </tr>
                                ))}
                                {selectedClient && getClientChecks(selectedClient).length > 0 && (
                                    <tr>
                                        <td colSpan="3" className="client-checks-hint">
                                            {selectedClientChecks.length} of {getClientChecks(selectedClient).length} client checks selected.
                                            To send checks to {VENDOR_NAMES[String(vendor).toLowerCase()] || vendor}, tick the matching
                                            checks under <button type="button" className="link-button" onClick={() => setChecklistMode("vendor")}>Vendor Checklist</button>.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    )}

                    {checklistMode === "vendor" && (
                    <table className="checks-table">

                        <thead>

                            <tr>

                                <th>
                                    Select
                                </th>

                                <th>
                                    Check Name
                                </th>

                                <th>
                                    Description
                                </th>

                                <th>
                                    Quantity
                                </th>

                            </tr>

                        </thead>


                        <tbody>

                            {checks.map(
                                check => {

                                    const selected =
                                        selectedChecks.find(
                                            item =>
                                                item.id ===
                                                check.id
                                        );


                                    return (

                                        <tr
                                            key={
                                                check.id
                                            }
                                        >

                                            <td>

                                                <input
                                                    type="checkbox"
                                                    checked={
                                                        !!selected
                                                    }
                                                    onChange={() =>
                                                        toggleCheck(
                                                            check.id
                                                        )
                                                    }
                                                />

                                            </td>

                                            <td>
                                                {
                                                    check.name
                                                }
                                            </td>

                                            <td>
                                                <input
                                                    type="text"
                                                    value={check.description || ""}
                                                    placeholder="Type"
                                                    onChange={e =>
                                                        updateCheckDescription(
                                                            check.id,
                                                            e.target.value
                                                        )
                                                    }
                                                />
                                            </td>

                                            <td>

                                                <input
                                                    className="quantity"
                                                    type="number"
                                                    min="1"
                                                    value={
                                                        selected
                                                            ? selected.quantity
                                                            : 0
                                                    }
                                                    disabled={
                                                        !selected
                                                    }
                                                    onChange={e =>
                                                        updateQuantity(
                                                            check.id,
                                                            e.target.value
                                                        )
                                                    }
                                                />

                                            </td>

                                        </tr>

                                    );

                                }
                            )}

                            {checksLoading && (
                            <tr>
                                <td colSpan="4">
                                    Loading {vendor} checks...
                                </td>
                            </tr>
                            )}

                            {!checksLoading && checksError && (
                            <tr>
                                <td colSpan="4">
                                    {checksError}
                                </td>
                            </tr>
                            )}

                            {!checksLoading && !checksError && checksWarning && (
                            <tr>
                                <td colSpan="4" className="checks-warning">
                                    {checksWarning}
                                </td>
                            </tr>
                            )}

                            {!checksLoading && !checksError && checks.length === 0 && (
                            <tr>
                                <td colSpan="4">
                                    {["adamma", "cfirst"].includes(vendor.toLowerCase())
                                        ? `${vendor} returned no supported checks.`
                                        : "Select a configured vendor to load its checks."}
                                </td>
                            </tr>
                            )}

                        </tbody>

                    </table>
                    )}

                </div>

            </div>


            {/* Footer: vendor case (compact) and the Submit bar */}
            <div className="submit-area">

                {vendorCase?.caseId && (
                    <div className={`footer-case${footerCaseOpen ? "" : " footer-case-collapsed"}`}>
                        {renderCaseSection()}
                    </div>
                )}

                <div className="submit-row">

                <div className="submit-summary">
                    <strong>Submit to {VENDOR_NAMES[String(vendor).toLowerCase()] || vendor}</strong>
                    <span>
                        {selectedDocuments.length} document{selectedDocuments.length === 1 ? "" : "s"}
                        {" · "}
                        {selectedChecks.length} check{selectedChecks.length === 1 ? "" : "s"} selected
                    </span>
                </div>

                {message && (
                    <div className={`message message-${messageType}`} role="status">
                        {message}
                    </div>
                )}

                <button
                    className="submit-button"
                    onClick={submitToVendor}
                    disabled={loading}
                >

                    {loading
                        ? "Processing..."
                        : "Submit to Vendor"}

                </button>

                </div>

            </div>

        </div>

    );

}


export default App;
