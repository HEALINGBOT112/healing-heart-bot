const express = require('express'); // Fixed capitalization
const {
  default: makeWASocket,
  useMultiFileAuthState,
  Browsers,
  makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const fs = require('fs-extra');

const app = express();
// Railway provides the PORT, we must use 0.0.0.0 to be reachable
const port = process.env.PORT || 3000;

const activeSessions = new Set();

/* =========================
   HOME PAGE (GOLD UI)
========================= */
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Healing Heart Gateway</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:Segoe UI,system-ui;}
body{
  height:100vh;
  display:flex;
  justify-content:center;
  align-items:center;
  background:radial-gradient(circle at top,#0f2027,#000);
  color:#fff;
}
.card{
  width:380px;
  padding:35px;
  border-radius:25px;
  background:rgba(255,255,255,0.05);
  backdrop-filter:blur(20px);
  border:1px solid rgba(255,215,0,0.3);
  box-shadow:0 0 40px rgba(255,215,0,0.15);
  text-align:center;
  animation:fadeIn 1s ease;
}
.logo{
  font-size:55px;
  text-shadow:0 0 15px gold;
}
h1{
  font-size:26px;
  background:linear-gradient(45deg,gold,#ffd700,#fff2b3);
  -webkit-background-clip:text;
  -webkit-text-fill-color:transparent;
}
p{font-size:13px;color:#aaa;margin-bottom:20px;}
input{
  width:100%;
  padding:15px;
  border-radius:12px;
  border:1px solid rgba(255,215,0,0.4);
  outline:none;
  font-size:16px;
  text-align:center;
  margin-top:10px;
  background:rgba(255,255,255,0.08);
  color:#fff;
}
button{
  width:100%;
  margin-top:18px;
  padding:15px;
  border-radius:14px;
  background:linear-gradient(45deg,gold,#ffcc00);
  color:#000;
  border:none;
  font-size:16px;
  font-weight:bold;
  cursor:pointer;
  transition:0.3s;
}
button:hover{
  transform:translateY(-2px);
  box-shadow:0 0 20px gold;
}
@keyframes fadeIn{
  from{opacity:0;transform:translateY(20px);}
  to{opacity:1;transform:translateY(0);}
}
</style>
</head>
<body>
<div class="card">
  <div class="logo">💛</div>
  <h1>Healing Heart</h1>
  <p>Secure WhatsApp Pairing Gateway</p>
  <input id="phone" placeholder="234XXXXXXXXXX"/>
  <button onclick="go()">🔐 Generate Code</button>
</div>
<script>
function go(){
  const num = document.getElementById("phone").value.trim();
  if(!num) return alert("Enter your number");
  window.location.href = "/code?number=" + num;
}
</script>
</body>
</html>
`);
});

/* =========================
   PAIRING ROUTE
========================= */
app.get("/code", async (req, res) => {
  let num = (req.query.number || "").replace(/[^0-9]/g, '');

  if (!num) return res.send("<h3>Invalid number</h3>");

  if (activeSessions.has(num)) {
    return res.send("<h3>Session already running. Wait a few seconds...</h3>");
  }

  activeSessions.add(num);
  const sessionPath = './sessions/' + num;

  try {
    await fs.ensureDir(sessionPath);
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
      },
      logger: pino({ level: "silent" }),
      browser: Browsers.macOS("Chrome"),
      printQRInTerminal: false,
      connectTimeoutMs: 60000
    });

    sock.ev.on('creds.update', saveCreds);

    let codeSent = false;

    sock.ev.on('connection.update', async (update) => {
      const { connection } = update;

      if (connection === "connecting" && !codeSent) {
        try {
          const code = await sock.requestPairingCode(num);
          codeSent = true;

          if (!res.headersSent) {
            res.send(`
            <body style="background:black;color:white;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">
              <div style="text-align:center;">
                <h1 style="font-size:60px;letter-spacing:10px;color:gold;">${code}</h1>
                <p>Enter this code in WhatsApp</p>
                <br><a href="/" style="color:gold;">Go Back</a>
              </div>
            </body>
            `);
          }
        } catch (e) {
          console.log("Pairing Error:", e.message);
          if (!res.headersSent) {
            res.send("<h3>Connection busy. Try again.</h3>");
          }
        }
      }

      if (connection === "open") {
        console.log("Connected:", num);
        activeSessions.delete(num);
      }

      if (connection === "close") {
        console.log("Closed:", num);
        activeSessions.delete(num);
      }
    });

    setTimeout(() => {
      if (!res.headersSent) {
        res.send("<h3>Timeout. Try again.</h3>");
        activeSessions.delete(num);
      }
    }, 45000); // Increased timeout slightly for slower connections

  } catch (err) {
    console.log(err);
    activeSessions.delete(num);
    if (!res.headersSent) res.send("<h3>Server error</h3>");
  }
});

/* ========================= */
// CRITICAL FIX: Added '0.0.0.0' for Railway exposure
app.listen(port, "0.0.0.0", () => {
  console.log("Server running on port " + port);
});
