# Email Campaign Manager — Frontend

A production-style web client for creating, validating, sending and reviewing
bulk email campaigns.

## Features

- Google Sign In (handled entirely by the backend OAuth flow)
- Dashboard overview with live campaign totals
- Campaign composer with sender details, subject, message, attachments and
  recipient validation
- Campaign history with search and details view

## Stack

- TanStack Start
- React
- TypeScript
- Tailwind CSS

## Getting started

Requires Node.js and npm.

```sh
npm install
npm run dev
```

Point `VITE_API_BASE_URL` at your backend URL to connect the frontend to the
Email Campaign API.
