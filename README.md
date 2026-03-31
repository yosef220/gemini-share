# GeminiShare

אפליקציה לשיתוף קודי Gemini Pro בין משתמשים.

---

## מה צריך לפני שמתחילים

- חשבון [GitHub](https://github.com)
- חשבון [Firebase](https://console.firebase.google.com) (חינם)
- [Node.js](https://nodejs.org) מותקן על המחשב (גרסה 18+)
- [Git](https://git-scm.com) מותקן על המחשב

---

## שלב 1 — יצירת פרויקט Firebase

1. כנס ל-[Firebase Console](https://console.firebase.google.com)
2. לחץ **Add project** → תן שם (למשל `gemini-share`) → **Continue**
3. בטל את Google Analytics (לא חובה) → **Create project**

### הפעלת Authentication

1. בתפריט הצדדי לחץ **Build → Authentication**
2. לחץ **Get started**
3. בלשונית **Sign-in method** לחץ על **Google**
4. הפעל ✅ ובחר אימייל תמיכה (שלך)
5. לחץ **Save**

### הפעלת Firestore

1. בתפריט הצדדי לחץ **Build → Firestore Database**
2. לחץ **Create database**
3. בחר **Start in production mode** → בחר אזור קרוב (למשל `europe-west1`) → **Create**
4. לך ללשונית **Rules** והחלף את התוכן ב:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    match /codes/{codeId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
        && request.resource.data.uploadedBy == request.auth.uid
        && request.resource.data.remainingSlots == 10
        && request.resource.data.takenSlots == 0
        && request.resource.data.code is string
        && request.resource.data.code.size() >= 10;
      allow update: if request.auth != null
        && request.resource.data.remainingSlots >= 0
        && request.resource.data.takenSlots <= 10
        && request.resource.data.uploadedBy == resource.data.uploadedBy
        && request.resource.data.code == resource.data.code;
    }

    match /reports/{reportId} {
      allow create: if request.auth != null
        && request.resource.data.reportedBy == request.auth.uid;
      allow read: if false;
    }
  }
}
```

5. לחץ **Publish**

### קבלת מפתחות Firebase

1. לחץ על ⚙️ ליד **Project Overview** → **Project settings**
2. גלול למטה ל-**Your apps** → לחץ על אייקון **Web** (`</>`)
3. תן שם (למשל `gemini-share-web`) → **Register app**
4. תראה את הקונפיגורציה — **שמור את הערכים הבאים** (תצטרך אותם בשלב 3):

```
apiKey: "..."
authDomain: "..."
projectId: "..."
storageBucket: "..."
messagingSenderId: "..."
appId: "..."
```

### הוספת הדומיין המורשה

1. ב-Firebase Console → **Authentication → Settings → Authorized domains**
2. לחץ **Add domain**
3. הוסף את הדומיין של GitHub Pages שלך: `YOUR-USERNAME.github.io`

---

## שלב 2 — העלאה ל-GitHub

1. צור repository חדש ב-GitHub (למשל `gemini-share`)
2. פתח טרמינל בתיקיית הפרויקט והרץ:

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/gemini-share.git
git push -u origin main
```

---

## שלב 3 — הגדרת Secrets ב-GitHub

1. כנס ל-Repository שלך ב-GitHub
2. לך ל-**Settings → Secrets and variables → Actions**
3. לחץ **New repository secret** והוסף כל אחד מהערכים:

| Name | Value |
|------|-------|
| `VITE_FIREBASE_API_KEY` | ה-apiKey מ-Firebase |
| `VITE_FIREBASE_AUTH_DOMAIN` | ה-authDomain מ-Firebase |
| `VITE_FIREBASE_PROJECT_ID` | ה-projectId מ-Firebase |
| `VITE_FIREBASE_STORAGE_BUCKET` | ה-storageBucket מ-Firebase |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | ה-messagingSenderId מ-Firebase |
| `VITE_FIREBASE_APP_ID` | ה-appId מ-Firebase |

---

## שלב 4 — הפעלת GitHub Pages

1. ב-Repository → **Settings → Pages**
2. תחת **Source** בחר **GitHub Actions**
3. Push כלשהו ל-`main` יפעיל את הבנייה וההעלאה אוטומטית

האתר יהיה זמין ב: `https://YOUR-USERNAME.github.io/gemini-share/`

---

## הרצה מקומית (לפיתוח)

1. צור קובץ `.env` בתיקיית הפרויקט (העתק מ-`.env.example` ומלא את הערכים)
2. הרץ:

```bash
npm install
npm run dev
```

---

## אבטחה

- **Firebase Authentication** — כניסה עם magic link (ללא סיסמה)
- **Firestore Security Rules** — כל משתמש יכול לקרוא/לכתוב רק את הנתונים שלו; קודים מוגנים מפני מניפולציה
- **Environment Variables** — מפתחות Firebase נשמרים כ-GitHub Secrets ולא בקוד
- **Input Validation** — ולידציה בצד הלקוח + כללי אבטחה בצד השרת
- **No Mock Data** — כל הנתונים אמיתיים ומאוחסנים ב-Firestore
