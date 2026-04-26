# Environment Template (Production)

এই টেমপ্লেটটি Portainer Stack‑এর **Environment Variables** এ বসান।  
সবকিছু এক জায়গায় রাখলে ডিপ্লয় করা সবচেয়ে সহজ হবে।

---

## ✅ Required (চলতেই হবে)
```
POSTGRES_USER=USER
POSTGRES_PASSWORD=PASSWORD
POSTGRES_DB=DB

APP_URL=https://your-domain.com
NEXT_PUBLIC_APP_URL=https://your-domain.com
NEXT_PUBLIC_API_URL=https://your-domain.com

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
CLERK_WEBHOOK_SECRET=svix_...
```

> NOTE: আমরা `docker-compose.yml`‑এ `DATABASE_URL` নিজে গঠন করছি  
> `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}`

---

## ✅ Required (যদি external DB ব্যবহার করেন)
```
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DB
```

---

## ✅ Required (যদি external Redis ব্যবহার করেন)
```
REDIS_URL=redis://HOST:6379
REDIS_USERNAME=...
REDIS_PASSWORD=...
REDIS_DB=0
REDIS_TLS=true
```

---

## ✅ Cron / Maintenance (রিকমেন্ডেড)
```
CRON_SECRET=your_random_secret
REVALIDATION_TOKEN=your_random_token
```

---

## ✅ SMS (যদি SMS ব্যবহার করেন)
```
NEXT_PUBLIC_MIM_SMS_USERNAME=...
NEXT_PUBLIC_MIM_SMS_API_KEY=...
NEXT_PUBLIC_MIM_SMS_SENDER_NAME=...
ALLOW_SYNC_SMS=false
```

---

## ✅ Dev only
```
NEXT_PUBLIC_MOCK_ROLE=Admin
```
