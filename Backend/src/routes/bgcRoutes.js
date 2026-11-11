const express = require("express");

const {
    getEmployeeDetails,
    getEmployeeAttachment,
    getEducationAttachments,
    getAdditionalAttachments,
    getAllEmployeeAttachments
} = require("../services/successFactorsService");

const router = express.Router();

router.get("/education-attachments", async (req, res) => {
    try {
        const documents = await getEducationAttachments(req.query.employeeId);
        res.json({ success: true, documents });
    } catch (error) {
        console.error(error);
        res.status(error.cause?.response?.status ? 502 : 500).json({
            success: false,
            message: error.message || "Failed to fetch education attachments"
        });
    }
});

router.get("/additional-attachments", async (req, res) => {
    try {
        const result = await getAdditionalAttachments(
            req.query.personIdExternal,
            req.query.previousEmploymentId,
            req.query.educationRecordId
        );
        res.json({ success: true, ...result });
    } catch (error) {
        console.error(error);
        res.status(error.cause?.response?.status ? 502 : 500).json({
            success: false,
            message: error.message || "Failed to fetch personal and previous employment attachments"
        });
    }
});

router.get("/attachments", async (req, res) => {
    try {
        const result = await getAllEmployeeAttachments(
            req.query.educationRecordId,
            req.query.personIdExternal,
            req.query.previousEmploymentId
        );
        res.json({ success: true, ...result });
    } catch (error) {
        console.error(error);
        res.status(error.cause?.response?.status ? 502 : 500).json({
            success: false,
            message: error.message || "Failed to fetch employee attachments"
        });
    }
});


router.get("/:id/bgc-details", async (req, res) => {

    try {

        const employeeRecordId =
            req.params.id;

        const data =
            await getEmployeeDetails(
                employeeRecordId
            );

        res.json({
            success: true,
            ...data
        });

    } catch (error) {

        console.error(error);

        res.status(
            error.status ||
            (error.cause?.response?.status ? 502 : 500)
        ).json({
            success: false,
            message: error.message || "Failed to fetch BGC details"
        });

    }

});

router.get("/:id/attachments/:attachmentId", async (req, res) => {
    try {
        const attachment = await getEmployeeAttachment(
            req.params.id,
            req.params.attachmentId
        );

        res.type(attachment.mimeType);
        res.attachment(attachment.fileName);
        res.send(attachment.content);
    } catch (error) {
        console.error(error);

        res.status(
            error.status ||
            (error.cause?.response?.status ? 502 : 500)
        ).json({
            success: false,
            message: error.message || "Failed to fetch attachment from SuccessFactors"
        });
    }
});


module.exports = router;
