# Background Verification Document Portal: BTP deployment

The frontend and backend deploy as separate Cloud Foundry applications. Run the commands from a Cloud Foundry CLI terminal logged into the target BTP subaccount and org/space.

## 1. Deploy the backend

```powershell
cd Backend
cf push -f manifest.yml
cf app bgv-backend
```

Set the SuccessFactors and vendor credentials as Cloud Foundry environment variables. Do not put credentials in the manifests or frontend build.

```powershell
cf set-env bgv-backend SF_BASE_URL "https://<successfactors-host>/odata/v2/cust_BGV"
cf set-env bgv-backend SF_USERNAME "<successfactors-username>"
cf set-env bgv-backend SF_PASSWORD "<successfactors-password>"
cf set-env bgv-backend ADAMMA_USER_ID "<adamma-user-id>"
cf set-env bgv-backend ADAMMA_PASSWORD "<adamma-password>"
cf set-env bgv-backend CFIRST_USER_NAME "<cfirst-username>"
cf set-env bgv-backend CFIRST_PASSWORD "<cfirst-password>"
cf set-env bgv-backend CFIRST_API_KEY "<cfirst-api-key>"
cf restage bgv-backend
```

`SF_BASE_URL` must include the `/odata/v2/cust_BGV` entity path. The backend manifest uses the Node.js buildpack and checks `/api/health`.
For local development, copy `Backend/.env.example` to `Backend/.env` and configure the same cFirst variables there. Keep vendor credentials out of source control; cFirst authenticates with `UserName`, `Password`, and `Apikey` in the backend, not a refresh token.

## 2. Build and deploy the frontend

Get the backend route from `cf app bgv-backend`, then build the frontend with that public HTTPS URL:

```powershell
cd ..\Frontend
npm ci
$env:VITE_API_BASE_URL = "https://<bgv-backend-route>"
npm run build
cf push -f manifest.yml
```

The frontend manifest deploys the Vite `dist` output with the Staticfile buildpack. `public/Staticfile` enables client-side routing.

## 3. Allow the frontend origin

Get the generated frontend route from `cf app bgv-frontend`, then allow that exact origin on the backend:

```powershell
cd ..\Backend
cf set-env bgv-backend FRONTEND_ORIGINS "https://<bgv-frontend-route>"
cf restage bgv-backend
```

If the frontend route changes, rebuild it with the current backend URL and update `FRONTEND_ORIGINS` to the new frontend origin.
