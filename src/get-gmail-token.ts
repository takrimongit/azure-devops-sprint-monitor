/**
 * One-time script to obtain a Gmail OAuth2 refresh token.
 * Run: npx ts-node src/get-gmail-token.ts
 *
 * Requirements:
 *  - OAuth2 client must be type "Desktop app" in Google Cloud Console
 *  - http://localhost:4242 must be added as an Authorized redirect URI
 */
import * as http from "http";
import * as https from "https";
import dotenv from "dotenv";

dotenv.config();

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be set in .env");
  process.exit(1);
}

const PORT = 4242;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPE = "https://mail.google.com/";

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth` +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPE)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log("\n════════════════════════════════════════════");
console.log("  Gmail OAuth2 Refresh Token Setup");
console.log("════════════════════════════════════════════\n");
console.log("IMPORTANT: In Google Cloud Console, make sure:");
console.log("  1. OAuth client type is 'Desktop app'");
console.log(`  2. '${REDIRECT_URI}' is in Authorized redirect URIs\n`);
console.log("Open this URL in your browser:\n");
console.log("  " + authUrl);
console.log("\nWaiting for Google to redirect back...\n");

// Spin up a temporary local server to capture the auth code
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<h2>❌ Error: ${error}</h2><p>Check the terminal for details.</p>`);
    server.close();
    console.error(`\n❌ OAuth error: ${error}`);
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("No code received.");
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<h2>✅ Authorization successful!</h2><p>You can close this tab and return to the terminal.</p>");
  server.close();

  // Exchange code for tokens
  const postData = new URLSearchParams({
    code,
    client_id: CLIENT_ID!,
    client_secret: CLIENT_SECRET!,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  }).toString();

  const options = {
    hostname: "oauth2.googleapis.com",
    path: "/token",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(postData),
    },
  };

  const tokenReq = https.request(options, (tokenRes) => {
    let body = "";
    tokenRes.on("data", (chunk) => (body += chunk));
    tokenRes.on("end", () => {
      const json = JSON.parse(body);
      if (json.error) {
        console.error(`\n❌ Token error: ${json.error} — ${json.error_description}`);
        process.exit(1);
      }
      console.log("✅ Success! Add this to your .env file:\n");
      console.log(`GMAIL_REFRESH_TOKEN=${json.refresh_token}`);
      console.log("\nDone. You can delete src/get-gmail-token.ts after this.\n");
    });
  });

  tokenReq.on("error", (e) => console.error("Request error:", e));
  tokenReq.write(postData);
  tokenReq.end();
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT} ...`);
});
