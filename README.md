# CaterEase — Student Catering Jobs

A responsive website for students seeking catering and event shifts, with a coordinator dashboard for managing workers and applications.

## Features

- Student registration and email/password sign-in (18+)
- Event listings with location, date, role and shift pay
- Applications, statuses and individual account notifications
- Event creation, staffing requirements, applicant review, capacity and waitlist rules
- One role per student per event, five-hour cancellation cutoff, 2-person waitlist per role
- Admin role provisioning through a local command (no default admin password)
- Reporting one hour before event, India time; physical ID reminder
- Documented potential ₹500 no-show penalty flag (not charged)

**Demo events** appear on initial startup and are labelled `DEMO EVENT`. No real employer affiliation is implied.

## Requirements

- Node.js 22.13+ (Node's `node:sqlite` API is currently experimental)
- npm

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173 to use the React interface. The local API runs at http://localhost:3030.

The database is stored at `server/data/caterease.sqlite`, excluded from Git tracking.

## Create an administrator

1. Register normally in the app with an email address you own.
2. Stop the server. Then run:

```bash
npm run make-admin -- you@example.com
```

3. Restart the server and sign in again to see **Admin dashboard** in the user menu.

Do not set an arbitrary public admin signup or hardcode passwords.

## Build / run production

```bash
npm run build
npm start
```

The API serves the compiled frontend from `dist/`. Deploy on a Node.js host with durable disk storage, HTTPS, secure cookies and a persistent `DATA_DIR`. **GitHub Pages cannot run this backend**, so use an application host (or adapt it to managed backend hosting). Do not use an ephemeral disk for real student records.

## Important limitations

- The app uses a local SQLite database and the built-in Node HTTP server. It is designed as a functional development/academic project, not a production-ready staffing service.
- In-app notifications work. **Email sending is not configured**, and no outgoing email is claimed.
- Password reset and email verification are not implemented. Add verified email delivery and reset tokens before real-world launch.
- The app displays a potential no-show penalty but **does not collect payments**. Review any policy before using it with students.
- Admin access currently has a single `admin` role; a separate limited HR role and event-organizer account separation should be added before involving multiple organisations.
- Security hardening, data retention, rate limiting, audit and independent security testing are required before accepting real applicant data.
- Students should bring physical identification to a shift. The app deliberately does **not** store Aadhaar numbers, licence numbers or identity-document photos.
- For live use, define privacy notice/consent and incident procedures, reliable backups, transactional mail, and monitoring.

## Folder structure

- `src/`: React application and responsive styles
- `server/`: Native Node.js HTTP API, SQLite schema and authentication
- `public/`: App favicon

Run the automated backend tests with `npm test`.

## Repository checks

Pushes to the main branch run backend tests and build the frontend through GitHub Actions. This is an academic/development application. Keep test data separate from real student records and do not include local database files in commits.
