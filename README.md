# CaterEase — Student Catering Jobs

A full-stack academic project for student part-time catering jobs and event staffing.

## Development

Requires Node.js 22.13+.

```bash
npm install
npm run dev
```

The web frontend runs at http://localhost:5173 and the Node.js API at http://localhost:3030.

## Features

- Student registration and sign-in (18+)
- Searchable catering/event roles, shift details and applications
- Application cancellation and statuses
- Event staffing dashboard, approvals and waitlisting
- SQLite persistence, server-side role checks and in-app notifications

## Status and security

This is a development project. Email verification, password recovery, production hardening, backups, and real email sending require additional work before use with real applicants. No real government ID data is collected. Demo events are labelled.

## Deployment

GitHub Pages only hosts static files; this project needs a Node.js host with persistent storage for the backend.
