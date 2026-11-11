const express = require("express");
const { randomUUID } = require("crypto");
const config = require("../config/config");

const {
    initiateBGC,
    getVendorCatalog,
    getLastKnownAdammaChecks,
    getAdammaCaseStatus,
    syncAdammaCaseStatus,
    getVendorCaseStatus,
    syncVendorCaseStatus
} = require("../services/vendorService");

const router = express.Router();

function getSafeVendorDebug(debug) {
    if (!debug || typeof debug !== "object") return null;
    const snippet = typeof debug.responseSnippet === "string"
        ? debug.responseSnippet.replace(/\s+/g, " ").trim().slice(0, 500)
        : "";
    return {
        status: debug.status || null,
        code: debug.code || "",
        hasResponse: Boolean(debug.hasResponse),
        responseSnippet: snippet
    };
}

router.get("/checks", async (req, res) => {
    try {
        const { checks, packages, warning } = await getVendorCatalog(req.query.vendor || "");
        res.json({
            success: true,
            checks,
            packages,
            ...(warning ? { warning } : {})
        });
    } catch (error) {
        console.error("Vendor checklist request failed", {
            vendor: req.query.vendor || "",
            message: error.message,
            status: error.cause?.response?.status
        });
        if (
            String(req.query.vendor || "").toLowerCase() === "adamma" &&
            ["ETIMEDOUT", "ECONNABORTED", "ECONNREFUSED", "ENETUNREACH"]
                .includes(error.cause?.code || error.code)
        ) {
            return res.json({
                success: true,
                checks: getLastKnownAdammaChecks(),
                packages: [],
                warning: "Adamma is temporarily unreachable. Showing the last known checklist."
            });
        }
        res.status(error.cause?.response?.status ? 502 : 500).json({
            success: false,
            message: error.message || "Failed to fetch vendor checks"
        });
    }
});


router.post("/initiate-bgc", async (req, res) => {
    const requestId = randomUUID();

    try {

        const {
            employeeId,
            vendor,
            preProfileNumber,
            docType,
            educationRecordId,
            personIdExternal,
            previousEmploymentId,
            candidateInfo,
            selectedDocs,
            selectedChecks,
            packageId,
            packageName
        } = req.body;


        if (!employeeId) {

            return res.status(400).json({
                success: false,
                message: "Employee ID is required"
            });

        }


        if (!vendor) {

            return res.status(400).json({
                success: false,
                message: "Vendor is required"
            });

        }


        if (String(vendor).toLowerCase() === "adamma" && !preProfileNumber) {

            return res.status(400).json({
                success: false,
                message:
                    "Pre Profile Number is required"
            });

        }


        if (!Array.isArray(selectedDocs) || selectedDocs.length === 0) {

            return res.status(400).json({
                success: false,
                message:
                    "Please select at least one document"
            });

        }


        if (!Array.isArray(selectedChecks) || selectedChecks.length === 0) {

            return res.status(400).json({
                success: false,
                message:
                    "Please select at least one check"
            });

        }

        if (String(vendor).toLowerCase() === "cfirst" && (!packageId || !packageName)) {
            return res.status(400).json({
                success: false,
                message: "Select a cFirst package"
            });
        }


        const payload = {
            employeeId,
            vendor,
            preProfileNumber,
            docType,
            educationRecordId,
            personIdExternal,
            previousEmploymentId,
            candidateInfo,
            selectedDocs,
            selectedChecks,
            packageId,
            packageName
        };


        const result =
            await initiateBGC(payload);


        res.status(200).json(result);


    } catch (error) {
        const statusCode = error.status || (error.cause?.response?.status ? 502 : 500);
        const errorDetails = {
            stage: error.stage || "",
            vendorStatus: error.cause?.response?.status || error.vendorStatus || "",
            vendorCode: error.cause?.code || error.vendorCode || "",
            vendorMessage: error.vendorMessage || ""
        };
        if (
            config.cFirst.debugErrors &&
            String(req.body.vendor || "").toLowerCase() === "cfirst"
        ) {
            errorDetails.vendorDebug = getSafeVendorDebug(error.vendorDebug);
        }
        if (String(req.body.vendor).toLowerCase() === "cfirst") {
            console.error("cFirst initiation failed", {
                requestId,
                message: error.message,
                status: error.cause?.response?.status,
                code: error.cause?.code || error.code,
                stage: error.stage,
                details: errorDetails
            });
            if (config.cFirst.debugErrors && error.vendorDebug) {
                console.error("cFirst initiation vendor debug", {
                    requestId,
                    debug: getSafeVendorDebug(error.vendorDebug)
                });
            }
        } else {
            if (error.cause?.response) {
                console.error("Adamma initiation rejected the request", {
                    requestId,
                    status: error.cause.response.status,
                    data: error.cause.response.data
                });
            } else {
                console.error("Vendor initiation failed", {
                    requestId,
                    message: error.message || "Failed to initiate BGC"
                });
            }
        }

        res.status(statusCode).json({
            success: false,
            message: error.message || "Failed to initiate BGC",
            requestId,
            details: errorDetails
        });

    }

});


// Current Adamma status for a case, without touching SuccessFactors.
// GET /api/vendor/adamma/case-status?caseId=ATES137
router.get("/adamma/case-status", async (req, res) => {
    try {
        const data = await getAdammaCaseStatus(String(req.query.caseId || req.query.caseid || ""));
        res.json({ success: true, ...data });
    } catch (error) {
        console.error("Adamma case status failed", { message: error.message });
        res.status(error.status || 500).json({
            success: false,
            message: error.message || "Failed to get Adamma case status"
        });
    }
});

// Reads the latest Adamma status and writes it to the employee's cust_BGV record.
// POST /api/vendor/adamma/sync-status  { "employeeId": "1006001", "caseId": "ATES137" }
// caseId is optional: if left out it is read from SuccessFactors.
router.post("/adamma/sync-status", async (req, res) => {
    try {
        const result = await syncAdammaCaseStatus(req.body?.employeeId, req.body?.caseId);
        res.json(result);
    } catch (error) {
        console.error("Adamma status sync failed", {
            employeeId: req.body?.employeeId,
            message: error.message
        });
        res.status(error.status || (error.cause?.response?.status ? 502 : 500)).json({
            success: false,
            message: error.message || "Failed to sync Adamma case status"
        });
    }
});


// Any vendor that supports it (Adamma, Parishram).
// GET /api/vendor/case-status?vendor=parishram&caseId=CASE2026...
router.get("/case-status", async (req, res) => {
    try {
        const data = await getVendorCaseStatus(
            String(req.query.vendor || ""),
            String(req.query.caseId || req.query.caseid || ""),
            String(req.query.refId || "")
        );
        res.json({ success: true, ...data });
    } catch (error) {
        console.error("Vendor case status failed", { vendor: req.query.vendor, message: error.message });
        res.status(error.status || 500).json({
            success: false,
            message: error.message || "Failed to get vendor case status"
        });
    }
});

// POST /api/vendor/sync-status  { "vendor": "parishram", "employeeId": "1028637", "caseId": "CASE2026..." }
router.post("/sync-status", async (req, res) => {
    try {
        const result = await syncVendorCaseStatus(
            req.body?.vendor,
            req.body?.employeeId,
            req.body?.caseId,
            req.body?.refId
        );
        res.json(result);
    } catch (error) {
        console.error("Vendor status sync failed", {
            vendor: req.body?.vendor,
            employeeId: req.body?.employeeId,
            message: error.message
        });
        res.status(error.status || (error.cause?.response?.status ? 502 : 500)).json({
            success: false,
            message: error.message || "Failed to sync vendor case status"
        });
    }
});


// Final report of a case as a file: /api/vendor/report?vendor=cfirst&caseId=61836[&download=1]
router.get("/report", async (req, res) => {
    try {
        const { getVendorReport } = require("../services/vendorService");
        const file = await getVendorReport(
            String(req.query.vendor || ""),
            String(req.query.caseId || ""),
            String(req.query.refId || "")
        );
        const disposition = String(req.query.download || "") === "1" ? "attachment" : "inline";
        res.setHeader("Content-Type", file.contentType);
        res.setHeader("Content-Disposition", `${disposition}; filename="${file.fileName.replace(/"/g, "")}"`);
        res.send(file.buffer);
    } catch (error) {
        console.error("Report download failed", error.message);
        res.status(error.status || 500).json({ success: false, message: error.message });
    }
});

module.exports = router;