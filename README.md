# BOOYAHX — Competitive Gaming Tournament Platform

A full-stack esports tournament platform with real authentication, database, and wallet system.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
copy .env.example .env
```

Edit `.env` with your configuration.

### 3. Start the Server

```bash
npm start
```

Or for development with auto-restart:

```bash
npm run dev
```

### 4. Access the Application

- **Public Website**: http://localhost:3000
- **Owner Console**: http://localhost:3000/owner/login.html
- **API**: http://localhost:3000/api

## Owner Accounts

Owner passwords are **never stored in code or documentation**. They are read
from environment variables on first boot:

| Role | Email | Password source |
|------|-------|-----------------|
| Primary Owner | `itxmeshadow1234@gmail.com` | `PRIMARY_OWNER_PASSWORD` in `.env` |
| Temporary Owner | `murtaza12@gmail.com` | `TEMPORARY_OWNER_PASSWORD` in `.env` |

If the variables are missing, the server generates a random password on first
boot and prints it to the console once. Set your own values in `.env` before
starting:

```
PRIMARY_OWNER_PASSWORD=your-strong-password
TEMPORARY_OWNER_PASSWORD=another-strong-password
```

## Features

### Public Website
- Tournament discovery and joining
- Real-time player counts
- Wallet with transaction history
- Deposit and withdrawal system
- Events, news, and updates
- User profiles and settings

### Owner Console
- Dashboard with real statistics
- User management
- Tournament creation and management
- Result publishing
- Deposit/withdrawal review
- Audit logs
- Developer console
- Platform settings

### Security
- Server-side authentication
- Password hashing with bcrypt
- Session-based authorization
- Role-based access control
- Rate limiting
- Input validation
- CSRF protection
- Audit logging

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Create account
- `POST /api/auth/signin` - Sign in
- `POST /api/auth/signout` - Sign out
- `GET /api/auth/me` - Get current user

### Tournaments
- `GET /api/tournaments` - List tournaments
- `GET /api/tournaments/:id` - Get tournament details
- `POST /api/tournaments` - Create tournament (owner only)
- `POST /api/tournaments/:id/join` - Join tournament

### Wallet
- `GET /api/wallet` - Get wallet balance
- `GET /api/wallet/transactions` - Get transaction history

### Owner
- `GET /api/owner/stats` - Dashboard statistics
- `GET /api/owner/users` - List users
- `GET /api/owner/audit-logs` - View audit logs
- `GET /api/owner/system-status` - System status

## Database

SQLite database with tables for:
- Users and profiles
- Tournaments and registrations
- Wallets and transactions
- Deposits and withdrawals
- Events, news, updates
- Notifications and reports
- Audit logs
- Platform settings

## Project Structure

```
BooyahX/
├── server/
│   ├── index.js          # Main server file
│   ├── db.js             # Database layer
│   └── middleware/
│       └── auth.js       # Authentication middleware
├── js/
│   ├── main.js           # Frontend main script
│   ├── data-service.js   # API service layer
│   └── owner-auth.js     # Owner authentication
├── owner/                # Owner dashboard pages
├── css/
│   └── style.css         # Main stylesheet
├── data/                 # SQLite database (created on first run)
├── .env.example          # Example environment file
└── package.json          # Dependencies
```

## Environment Variables

See `.env.example` for all available configuration options.

## Security Notes

- Never commit `.env` to version control
- Change default owner passwords before production
- Use HTTPS in production
- Set strong `SESSION_SECRET` in production
- Configure payment provider credentials securely
- Regularly backup the database

## License

Proprietary — All rights reserved.
