# NSync

Sync an **Obsidian vault across desktop and mobile** through **your own Google
Drive** — a single Obsidian community plugin (macOS · iOS · Android), no server,
no third-party sync service.

Files live in Drive's hidden **`appDataFolder`**, you sign in with **your own
Google account**, and everything runs inside Obsidian.

> สำหรับใช้เอง (personal use). ออกแบบให้ "เบา ไม่พึ่ง software อื่น" — ทุกอย่างเป็น
> plugin ตัวเดียว เขียนด้วย TypeScript รันได้ทุก platform ที่ Obsidian รองรับ

---

## Features

- 🔁 **Two-way sync** — แก้ที่เครื่องไหนก็กระจายไปทุกเครื่อง
- 🖥️📱 **ทุก platform จากโค้ดชุดเดียว** — Obsidian desktop + mobile (ไม่ใช้ Electron/React Native แยก)
- 🔐 **Google OAuth (PKCE)** — login ด้วยบัญชีตัวเอง, ไฟล์ไม่ปนกันระหว่างผู้ใช้
- 🗂️ **เก็บที่ `appDataFolder`** — scope แคบ (`drive.appdata`), ไม่ต้องผ่าน security assessment หนักของ Google
- 🧩 **Conflict copy** — แก้ไฟล์เดียวกันพร้อมกันไม่ทำข้อมูลหาย (เก็บทั้งสองเวอร์ชัน)
- 🪦 **Tombstones** — ลบไฟล์แล้วไม่ "ฟื้นคืนชีพ" แม้ต่อเครื่องใหม่
- ⏱️ **Auto-sync ทุก 60 วิ + ปุ่ม manual**
- 📵 **Mobile-aware** — ข้ามไฟล์ใหญ่ > 50MB บนมือถือ

การตัดสินใจเชิงออกแบบดูได้ที่ [CONTEXT.md](CONTEXT.md) และ [docs/adr/](docs/adr/).

---

## How it works

```
Obsidian (desktop/mobile)
        │  Vault API (อ่าน/เขียนไฟล์)
        ▼
   NSync plugin ──── 3-way reconcile ────┐
        │  local index (data.json)        │
        ▼                                  ▼
  Google Drive REST  ◄────────────  appDataFolder
   (requestUrl, PKCE)                (ไฟล์ vault + tombstones)
```

Reconcile เทียบ 3 สถานะต่อไฟล์: **local** × **remote** × **base** (index ที่ sync
สำเร็จครั้งก่อน) แล้วตัดสินว่าจะ upload / download / conflict / delete — logic นี้
เป็น pure function ([src/sync/reconcile.ts](src/sync/reconcile.ts)) และมี unit test
ครอบทุกเคส ([test/reconcile.test.ts](test/reconcile.test.ts)).

---

## Prerequisites

- Node.js ≥ 18 (dev ใช้ 22)
- Obsidian ≥ 1.5.0
- Google account + Google Cloud project (ฟรี)

---

## 1. Google Cloud setup

1. เปิด [Google Cloud Console](https://console.cloud.google.com/) → สร้าง project
2. **APIs & Services → Library** → เปิด **Google Drive API**
3. **OAuth consent screen**
   - User type: **External**
   - เพิ่ม scope: `https://www.googleapis.com/auth/drive.appdata`
   - **Publishing status → Publish to Production**
     (ถ้าปล่อยไว้ "Testing" refresh token จะหมดอายุทุก ~7 วัน)
   - ยอมรับหน้าเตือน "unverified app" ได้ — เป็นแอปของคุณเอง (จำกัด 100 users)
4. **Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application** ← สำคัญ (type อื่นเพิ่ม redirect URI ได้ไม่ครบ)
   - **Authorised redirect URIs** → Add:
     - `http://127.0.0.1:42813`  (desktop loopback)
     - `https://<คุณ>.github.io/nsync/callback.html`  (mobile bridge)
5. copy **Client ID** + **Client Secret**

> ⏳ การแก้ redirect URIs อาจใช้เวลา 5 นาที–ไม่กี่ชั่วโมงกว่าจะมีผล

---

## 2. ใส่ credentials

```bash
cp src/auth/credentials.example.ts src/auth/credentials.ts
```

แล้วแก้ [src/auth/credentials.ts](src/auth/credentials.example.ts) ใส่ค่าจริง:

```ts
export const CLIENT_ID = "xxxx.apps.googleusercontent.com";
export const CLIENT_SECRET = "GOCSPX-xxxx";
```

> `credentials.ts` ถูก **gitignore** ไว้แล้ว — อย่า commit ค่าจริงขึ้น GitHub

---

## 3. Build & install

```bash
npm install
npm run build      # สร้าง main.js
```

copy 2 ไฟล์ไปที่โฟลเดอร์ plugin ของ vault:

```bash
<vault>/.obsidian/plugins/nsync/
├── manifest.json
└── main.js
```

เปิด Obsidian → **Settings → Community plugins** → เปิด **NSync**

---

## 4. Deploy mobile bridge (เฉพาะถ้าจะใช้บนมือถือ)

Google ไม่รับ custom scheme (`obsidian://`) เป็น redirect โดยตรง จึงต้องมีหน้า
https กลาง 1 หน้าเพื่อ forward code กลับเข้า Obsidian

1. สร้าง repo `nsync` บน GitHub
2. [callback.html](callback.html) อยู่ที่ root ของ repo อยู่แล้ว
3. **Settings → Pages** → serve จาก branch `main` (root)
4. เช็กว่าเปิด `https://<คุณ>.github.io/nsync/callback.html` ได้จริง
5. URL นี้ต้องตรงกับ Redirect URI ข้อ 1.4 เป๊ะๆ

หน้านี้เป็น static ล้วน ไม่มี server logic ไม่มี secret — ปลอดภัยที่จะ host

---

## 5. ใช้งาน

- **Sign in**: Settings → NSync → *Sign in with Google*
- **Sync**: กดไอคอน 🔄 บน ribbon หรือ command palette → *NSync: Sync now*
- **Auto-sync**: เปิด/ปิด + ตั้ง interval ได้ใน settings (default 60 วิ)
- **Mobile**: วาง Bridge URL ในช่อง settings (โผล่เฉพาะบนมือถือ) ก่อน sign in

> 📱 บนมือถือ Obsidian รัน plugin เฉพาะตอนแอปเปิด — auto-sync จะทำงานตอนเปิดแอป
> และตอนกดปุ่ม ไม่มี background sync จริง (ข้อจำกัดของ OS)

---

## Development

```bash
npm run dev        # esbuild watch mode
npm run typecheck  # tsc --noEmit
npm test           # unit tests (node --test + tsx)
```

โครงสร้าง:

```
src/
├── main.ts              plugin entry, timer, auth glue
├── settings.ts          settings tab
├── auth/
│   ├── oauth.ts         PKCE + token endpoints
│   ├── authManager.ts   desktop loopback / mobile bridge flows
│   └── credentials.ts   (gitignored) CLIENT_ID / CLIENT_SECRET
├── drive/driveClient.ts Google Drive REST (appDataFolder)
└── sync/
    ├── reconcile.ts     pure 3-way decision (unit-tested)
    ├── engine.ts        scan + apply + conflict handling
    ├── tombstones.ts    shared delete markers (on Drive)
    ├── indexStore.ts    per-device index (data.json)
    ├── hash.ts          SHA-1 (Web Crypto)
    └── types.ts         domain types
```

---

## Security notes

- **Refresh token เก็บ per-device** ใน `data.json` และ **ไม่ sync** ขึ้น Drive เด็ดขาด
- `credentials.ts` และ `data.json` อยู่ใน `.gitignore`
- ไฟล์ใน `appDataFolder` Google อ่านได้ (ยังไม่มี E2E encryption ใน v1)
- ถ้าเคยเผลอ commit `CLIENT_SECRET` ขึ้น GitHub → ไป **rotate** ใน Cloud Console

---

## Limitations (v1)

- ไม่มี real-time push (poll ทุก 60 วิ)
- ไม่มี background sync บนมือถือ
- ยังไม่ใช้ Drive Changes API (ทำ full list ทุกครั้ง — พอสำหรับ vault ส่วนตัว)
- retention purge ของ tombstone/trash ยังไม่ auto (มี API พร้อม แต่ยังไม่ wire)
- ยังไม่มี E2E encryption

---

## License

MIT
