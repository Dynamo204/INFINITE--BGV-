const axios = require("axios");
const config = require("./src/config/config");
(async () => {
    for (const method of ["options", "head", "get"]) {
        try {
            const response = await axios({ method, url: config.vendor.initiationUrl, timeout: 15000 });
            console.log(method.toUpperCase(), response.status, response.headers.allow || "no Allow header");
        } catch (error) {
            console.log(method.toUpperCase(), error.response?.status || "network error", error.response?.headers?.allow || "no Allow header");
        }
    }
})();
