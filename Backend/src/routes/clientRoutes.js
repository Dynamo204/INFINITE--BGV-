const express = require("express");
const {
    getClientChecklists,
    addClientChecks,
    deleteClientChecks
} = require("../services/clientChecklistService");

const router = express.Router();

function sendError(res, error, fallback) {
    console.error(fallback, error.message);
    res.status(error.status || 500).json({ success: false, message: error.message || fallback });
}

// Client-wise checklist from RAP: GET /api/clients/checklists[?refresh=1]
router.get("/checklists", async (req, res) => {
    try {
        const data = await getClientChecklists({ refresh: String(req.query.refresh || "") === "1" });
        res.json({ success: true, ...data });
    } catch (error) {
        sendError(res, error, "Client checklist failed");
    }
});

// Add a client with checks, or checks to an existing client:
// POST /api/clients/checklists { client, checks: ["Highest Education", ...] }
router.post("/checklists", async (req, res) => {
    try {
        const result = await addClientChecks(req.body?.client, req.body?.checks);
        res.json({ success: true, ...result });
    } catch (error) {
        sendError(res, error, "Adding to the client checklist failed");
    }
});

// Delete a whole client, or one check of it:
// DELETE /api/clients/checklists?client=Airtel[&check=GDC]
router.delete("/checklists", async (req, res) => {
    try {
        const result = await deleteClientChecks(
            String(req.query.client || ""),
            String(req.query.check || "")
        );
        res.json({ success: true, ...result });
    } catch (error) {
        sendError(res, error, "Deleting from the client checklist failed");
    }
});

module.exports = router;