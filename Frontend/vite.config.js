import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({

    plugins: [
        react()
    ],

    server: {

        port: 5173,

        proxy: {

            "/api": {


                target: "https://bgv-backend.cfapps.us10-001.hana.ondemand.com",
               //target:  "http://localhost:3000/",
                changeOrigin: true

            }

        }

    }

});
