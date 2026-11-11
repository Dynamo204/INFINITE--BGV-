const express = require("express");
const cors = require("cors");

const config = require("./config/config");

const employeeRoutes = require("./routes/employeeRoutes");
const bgcRoutes = require("./routes/bgcRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const clientRoutes = require("./routes/clientRoutes");

const app = express();

app.use(cors({
    origin(origin, callback) {
        const allowedOrigins = config.frontendOrigins;
        if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error("Origin is not allowed by CORS"));
    }
}));
app.use(express.json());

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "BGV Backend is running"
    });
});

app.use("/api/employees", employeeRoutes);
app.use("/api/employee", bgcRoutes);
app.use("/api/vendor", vendorRoutes);
app.use("/api/clients", clientRoutes);

app.listen(config.port, () => {
    console.log(
        `Backend running at http://localhost:${config.port}`
    );
});