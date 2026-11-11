const express = require("express");

const {
    getEmployees,
    searchSuccessFactorsUsers,
    getSuccessFactorsUserDirectory,
    getEmployeeInitiationDetails,
    createBgvEmployee
} = require("../services/successFactorsService");

const router = express.Router();

function sendEmployeeError(res, error, fallbackMessage) {
    const status = error.status ||
        (error.cause?.response?.status ? 502 : 500);
    console.error(error.message || fallbackMessage);
    res.status(status).json({
        success: false,
        message: error.message || fallbackMessage
    });
}

router.get("/search", async (req, res) => {
    const query = String(req.query.query || "").trim();
    if (!query) {
        return res.status(400).json({
            success: false,
            message: "An employee ID search term is required"
        });
    }

    try {
        const employees = await searchSuccessFactorsUsers(query);
        res.json({ success: true, employees });
    } catch (error) {
        sendEmployeeError(res, error, "Failed to search SuccessFactors employees");
    }
});

router.get("/directory", async (req, res) => {
    try {
        const employees = await getSuccessFactorsUserDirectory();
        res.json({ success: true, employees });
    } catch (error) {
        sendEmployeeError(res, error, "Failed to fetch SuccessFactors employees");
    }
});

router.get("/manager/:employeeId", async (req, res) => {
    try {
        const details = await getEmployeeInitiationDetails(req.params.employeeId);
        res.json({
            success: true,
            employeeId: details.employeeId,
            employeeName: details.employeeName,
            managerName: details.managerName,
            businessUnitCode: details.businessUnitCode,
            businessUnitName: details.businessUnitName
        });
    } catch (error) {
        sendEmployeeError(res, error, "Failed to load employee details from SuccessFactors");
    }
});

router.post("/initiate", async (req, res) => {
    try {
        const created = await createBgvEmployee(req.body || {});
        res.json({
            success: true,
            employee: created.employee,
            result: created.result
        });
    } catch (error) {
        sendEmployeeError(res, error, "Failed to create employee in SuccessFactors");
    }
});

router.get("/", async (req, res) => {

    try {

        const employees =
            await getEmployees();

        res.json({
            success: true,
            employees: employees
        });

    } catch (error) {

        console.error(error);

        res.status(error.cause?.response?.status ? 502 : 500).json({
            success: false,
            message: error.message || "Failed to fetch employees"
        });

    }

});


module.exports = router;